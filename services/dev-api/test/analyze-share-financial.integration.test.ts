import assert from "node:assert/strict";
import test from "node:test";

import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createMemoRun, memoDatabase } from "../../analyze/test/financial-fixtures.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createServiceAnalyzeAdapter } from "../src/analyze-adapter.ts";

test("sharing a memo to chat copies each engine section under its own certificate, and erasing the run takes the copy", { skip: !dockerAvailable(), timeout: 300_000 }, async (t) => {
  const { db, pool, templateId } = await memoDatabase(t, "dev-api-share-financial");
  const memo = await createMemoRun(db, pool, { templateId, playbookId: "earnings_quality" });
  const [trend] = (await memo.publish()).sections;
  assert.equal(trend?.status, "published");
  const certificate = trend.status === "published" ? trend.snapshot_id : "";

  const adapter = createServiceAnalyzeAdapter({
    db: pool as never,
    sealAnalyzeSnapshot: async () => {
      throw new Error("sharing seals nothing");
    },
  });
  const shared = await adapter.shareRunToChat({ userId: IDS.owner, runId: memo.runId, body: {} });

  const messages = async () => new Map((await db.query<{ snapshot_id: string; kinds: string[] }>(
    `select snapshot_id::text, array(select b ->> 'kind' from jsonb_array_elements(blocks) b) as kinds
       from chat_messages where thread_id = $1`,
    [shared.thread.thread_id],
  )).rows.map((row) => [row.snapshot_id, row.kinds]));
  assert.deepEqual(await messages(), new Map([[memo.snapshotId, ["rich_text"]], [certificate, ["financial_answer"]]]));

  await db.query(`delete from financial_runs where parent_id = $1`, [memo.runId]);
  assert.deepEqual(await messages(), new Map([[memo.snapshotId, ["rich_text"]]]), "erasing the run takes its chat copy");
});
