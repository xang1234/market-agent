import assert from "node:assert/strict";
import test from "node:test";

import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createMemoRun, memoDatabase } from "../../analyze/test/financial-fixtures.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createServiceAnalyzeAdapter } from "../src/analyze-adapter.ts";

const verdict = (id: string, extra: Record<string, unknown>) => ({ id, kind: "rich_text", segments: [{ type: "text", text: "Rating: Buy. Conviction: high." }], ...extra });

test("a stored v1 memo's final verdict is neither shown nor shared, and its other sections are", { skip: !dockerAvailable(), timeout: 300_000 }, async (t) => {
  const { db, pool, templateId } = await memoDatabase(t, "dev-api-v1-verdict");
  const memo = await createMemoRun(db, pool, {
    templateId,
    playbookId: "investment_memo",
    playbookVersion: 1,
    blocks: [
      verdict("tagged-verdict", { title: "Final verdict", data_ref: { kind: "analyze_run", id: "tagged", params: { playbook_section_id: "final_verdict" } } }),
      verdict("titled-verdict", { title: "Final verdict" }),
    ],
  });
  const adapter = createServiceAnalyzeAdapter({ db: pool as never, sealAnalyzeSnapshot: async () => { throw new Error("reading seals nothing"); } });

  const shown = await adapter.getRun({ userId: IDS.owner, runId: memo.runId });
  assert.deepEqual(shown.blocks.map((block) => block.id), ["summary-1"]);

  const shared = await adapter.shareRunToChat({ userId: IDS.owner, runId: memo.runId, body: {} });
  const texts = (await db.query<{ text: string }>(
    `select blocks::text as text from chat_messages where thread_id = $1`,
    [shared.thread.thread_id],
  )).rows.map((row) => row.text).join("\n");
  assert.match(texts, /Narrative memo\./u);
  assert.doesNotMatch(texts, /Rating|Conviction/u);
});
