// A memo section's snapshot, certificate, and memo record commit together or
// not at all. A failed section leaves declared partial results, never a memo
// that reads as complete, and a retry or the recovery worker publishes each
// section exactly once.

import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { listRecoverableRuns, recoverRun } from "../../financial-engine/src/recovery.ts";
import { requestCancellation } from "../../financial-engine/src/run-repo.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { snapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { analyzeFinancialRecovery, loadAnalyzeFinancialSections } from "../src/financial-section.ts";
import { committed, createMemoRun, memoDatabase } from "./financial-fixtures.ts";

test("analyze memo financial publication", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for analyze memo publication coverage");
    return;
  }
  const { db, pool, templateId } = await memoDatabase(t, "analyze-fin-publish");
  /** Fails the memo record for one section, as a storage fault after its snapshot and certificate were written. */
  const failSection = async (sectionId: string) => db.query(`
    create function fail_memo_section() returns trigger language plpgsql as $$
    begin
      if new.section_id = '${sectionId}' then raise exception 'memo store unavailable'; end if;
      return new;
    end $$;
    create trigger fail_memo_section before insert on analyze_run_financial_sections for each row execute function fail_memo_section();`);
  const restore = async () => db.query(`drop trigger fail_memo_section on analyze_run_financial_sections; drop function fail_memo_section();`);
  const statuses = (result: { sections: ReadonlyArray<{ section_id: string; status: string; reason_code?: string }> }) =>
    Object.fromEntries(result.sections.map((section) => [section.section_id, section.status === "gap" ? `gap:${section.reason_code}` : section.status]));

  await t.test("a failed section rolls back alone; the memo reads partial; the retry publishes it once", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "investment_memo" });
    await failSection("revenue_trend");
    let failed;
    try {
      failed = await memo.publish();
    } finally {
      await restore();
    }
    assert.deepEqual(statuses(failed), { financial_health: "published", revenue_trend: "gap:publication_failed" });
    assert.equal(failed.coverage, "partial", "a memo with a failed section never reads as complete");
    assert.deepEqual(await committed(db, memo.runId), { sections: 1, certificates: 1, plans: 1 }, "the failed section left no snapshot or certificate");
    assert.equal((await loadAnalyzeFinancialSections(db, { userId: IDS.owner, analyzeRunId: memo.runId }))!.coverage, "partial");

    const retried = await memo.publish();
    assert.deepEqual(statuses(retried), { financial_health: "published", revenue_trend: "published" });
    assert.equal(retried.coverage, "complete");
    assert.deepEqual(await committed(db, memo.runId), { sections: 2, certificates: 2, plans: 1 }, "each section published once, from the saved plan");
    assert.deepEqual(await memo.publish(), retried, "a further retry changes nothing");
  });

  await t.test("the recovery worker finishes an interrupted memo under the memo's owner", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "investment_memo" });
    await failSection("revenue_trend");
    try {
      await memo.publish();
    } finally {
      await restore();
    }
    const [run] = (await listRecoverableRuns(db, { parent_kinds: ["analyze_memo_run"], limit: 10 })).filter((candidate) => candidate.parent_id === memo.runId);
    assert.ok(run, "the interrupted run is recoverable");
    const client = snapshotTransactionClient(await pool.connect());
    try {
      const outcome = await recoverRun(client, run, {
        worker_id: "recovery-test",
        ttl_ms: 60_000,
        evidence: createEvidenceFinancialPort,
        parents: { analyze_memo_run: analyzeFinancialRecovery(pool) },
      });
      assert.equal(outcome.status, "resumed", JSON.stringify(outcome));
    } finally {
      client.release();
    }
    assert.deepEqual(await committed(db, memo.runId), { sections: 2, certificates: 2, plans: 1 });
    assert.equal((await loadAnalyzeFinancialSections(db, { userId: IDS.owner, analyzeRunId: memo.runId }))!.coverage, "complete");
  });

  await t.test("a memo that no longer belongs to the owner receives nothing", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "earnings_quality" });
    await db.query(`update analyze_templates set user_id = $2 where template_id = $1`, [templateId, IDS.other]);
    try {
      const result = await memo.publish();
      assert.deepEqual(statuses(result), { revenue_trend: "gap:publication_failed" });
      assert.deepEqual(await committed(db, memo.runId), { sections: 0, certificates: 0, plans: 1 });
    } finally {
      await db.query(`update analyze_templates set user_id = $2 where template_id = $1`, [templateId, IDS.owner]);
    }
  });

  await t.test("a cancelled calculation leaves its unpublished sections as cancelled gaps", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "investment_memo" });
    await failSection("revenue_trend");
    try {
      await memo.publish();
    } finally {
      await restore();
    }
    const run = (await db.query(`select run_id::text from financial_runs where parent_id = $1`, [memo.runId])).rows[0];
    await requestCancellation(db, IDS.owner, run.run_id);
    const result = await memo.publish();
    assert.deepEqual(statuses(result), { financial_health: "published", revenue_trend: "gap:run_cancelled" });
    assert.equal(result.coverage, "partial");
    assert.deepEqual(await committed(db, memo.runId), { sections: 1, certificates: 1, plans: 1 });
  });
});
