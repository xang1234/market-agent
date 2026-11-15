// A memo section's snapshot, certificate, and memo record commit together or
// not at all. A failed required section leaves declared partial results, never
// a memo that reads as complete, and a retry or the recovery worker publishes
// each section exactly once.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { listRecoverableRuns, recoverRun } from "../../financial-engine/src/recovery.ts";
import { requestCancellation } from "../../financial-engine/src/run-repo.ts";
import { IDS, seedCashResilience } from "../../financial-engine/test/db-fixtures.ts";
import { snapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { analyzeFinancialRecovery, loadAnalyzeFinancialSections } from "../src/financial-section.ts";
import { committed, createMemoRun, memoDatabase } from "./financial-fixtures.ts";

test("analyze memo financial publication", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for analyze memo publication coverage");
    return;
  }
  const { db, pool, templateId } = await memoDatabase(t, "analyze-fin-publish");
  await seedCashResilience(db);
  /** Fails the memo record for one section, as a storage fault after its snapshot and certificate were written. */
  const failSection = async (sectionId: string) => db.query(`
    create function fail_memo_section() returns trigger language plpgsql as $$
    begin
      if new.section_id = '${sectionId}' then raise exception 'memo store unavailable' using errcode = '58030'; end if;
      return new;
    end $$;
    create trigger fail_memo_section before insert on analyze_run_financial_sections for each row execute function fail_memo_section();`);
  const restore = async () => db.query(`drop trigger fail_memo_section on analyze_run_financial_sections; drop function fail_memo_section();`);
  const statuses = (result: { sections: ReadonlyArray<{ section_id: string; status: string; reason_code?: string }> }) =>
    Object.fromEntries(result.sections.map((section) => [section.section_id, section.status === "gap" ? `gap:${section.reason_code}` : section.status]));

  await t.test("a failed required section rolls back; the memo reads partial; the retry publishes each section once", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "investment_memo" });
    await failSection("financial_health");
    let failed;
    try {
      failed = await memo.publish();
    } finally {
      await restore();
    }
    // Units finalize in unit order; the first failure stops the drive, so revenue_trend waits for the retry.
    assert.deepEqual(statuses(failed), { financial_health: "gap:publication_failed", cash_resilience: "published", revenue_trend: "gap:publication_failed" });
    assert.equal(failed.coverage, "partial", "a memo with a failed required section never reads as complete");
    assert.deepEqual(await committed(db, memo.runId), { sections: 1, certificates: 1, plans: 1 }, "the failed section left no snapshot or certificate");
    assert.equal((await loadAnalyzeFinancialSections(db, { userId: IDS.owner, analyzeRunId: memo.runId }))!.coverage, "partial");

    const retried = await memo.publish();
    assert.deepEqual(statuses(retried), { financial_health: "published", cash_resilience: "published", revenue_trend: "published" });
    assert.equal(retried.coverage, "complete");
    assert.deepEqual(await committed(db, memo.runId), { sections: 3, certificates: 3, plans: 1 }, "each section published once, from the saved plan");
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
    assert.deepEqual(await committed(db, memo.runId), { sections: 3, certificates: 3, plans: 1 });
    assert.equal((await loadAnalyzeFinancialSections(db, { userId: IDS.owner, analyzeRunId: memo.runId }))!.coverage, "complete");
  });

  await t.test("an analyst agent's unfinished figure under a memo is cancelled, never resumed or filed as a section", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "investment_memo" });
    await memo.publish();
    const { rows: [agent] } = await db.query<{ run_id: string }>(
      `insert into financial_runs (user_id, parent_kind, parent_id, parent_version, request_key, request_hash, plan_id, feature_mode, knowledge_cutoff, policies)
       select user_id, parent_kind, parent_id, parent_version, 'agent:investment_thesis:0123456789abcdef', request_hash, plan_id, feature_mode, knowledge_cutoff, policies
         from financial_runs where parent_id = $1 and request_key = $1::text
       returning run_id::text`,
      [memo.runId],
    );
    const recoverable = async () => (await listRecoverableRuns(db, { parent_kinds: ["analyze_memo_run"], limit: 100 })).map((run) => run.run_id);
    const [run] = (await listRecoverableRuns(db, { parent_kinds: ["analyze_memo_run"], limit: 100 })).filter((candidate) => candidate.run_id === agent!.run_id);
    assert.ok(run, "the unfinished agent figure is listed");
    const client = snapshotTransactionClient(await pool.connect());
    try {
      const outcome = await recoverRun(client, run, {
        worker_id: "recovery-test",
        ttl_ms: 60_000,
        evidence: createEvidenceFinancialPort,
        parents: { analyze_memo_run: analyzeFinancialRecovery(pool) },
      });
      assert.equal(outcome.status, "skipped", JSON.stringify(outcome));
    } finally {
      client.release();
    }
    const { rows: [state] } = await db.query<{ execution_state: string }>(`select execution_state from financial_runs where run_id = $1`, [agent!.run_id]);
    assert.equal(state!.execution_state, "cancelled");
    assert.equal((await recoverable()).includes(agent!.run_id), false, "it leaves the recovery queue");
    assert.deepEqual(await committed(db, memo.runId), { sections: 3, certificates: 3, plans: 1 }, "nothing is filed as a memo section");
  });

  await t.test("an agent figure whose Generate may still run is left to it, and one whose Generate ended unsaved is erased", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "investment_memo" });
    await memo.publish();
    const unsaved = randomUUID();
    const figure = async (age: string) => (await db.query<{ run_id: string }>(
      `insert into financial_runs (user_id, parent_kind, parent_id, parent_version, request_key, request_hash, plan_id, feature_mode, knowledge_cutoff, policies, created_at)
       select user_id, parent_kind, $2::uuid, parent_version, 'agent:investment_thesis:' || md5(random()::text), request_hash, plan_id, feature_mode, knowledge_cutoff, policies, now() - $3::interval
         from financial_runs where parent_id = $1 and request_key = $1::text
       returning run_id::text`,
      [memo.runId, unsaved, age],
    )).rows[0]!.run_id;
    const recovered = async (runId: string) => {
      const [run] = (await listRecoverableRuns(db, { parent_kinds: ["analyze_memo_run"], limit: 100 })).filter((candidate) => candidate.run_id === runId);
      assert.ok(run, "the unleased figure is listed");
      const client = snapshotTransactionClient(await pool.connect());
      try {
        await recoverRun(client, run, { worker_id: "recovery-test", ttl_ms: 60_000, evidence: createEvidenceFinancialPort, parents: { analyze_memo_run: analyzeFinancialRecovery(pool) } });
      } finally {
        client.release();
      }
      return (await db.query<{ execution_state: string }>(`select execution_state from financial_runs where run_id = $1`, [runId])).rows[0]?.execution_state ?? "erased";
    };
    assert.equal(await recovered(await figure("1 second")), "pending", "reserved a moment ago, before its Generate leased it");
    assert.equal(await recovered(await figure("1 hour")), "erased", "older than any Generate lives, with no memo saved");
  });

  await t.test("a memo saved under investment_memo v1 reads its optional sections from v1", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "investment_memo", playbookVersion: 1 });
    await failSection("revenue_trend");
    let failed;
    try {
      failed = await memo.publish();
    } finally {
      await restore();
    }
    assert.equal(failed.coverage, "complete", "revenue_trend is optional in v1");
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

  await t.test("a failed optional section stays a gap in that section; the memo reads complete", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "investment_memo" });
    await failSection("revenue_trend");
    let failed;
    try {
      failed = await memo.publish();
    } finally {
      await restore();
    }
    assert.deepEqual(statuses(failed), { financial_health: "published", cash_resilience: "published", revenue_trend: "gap:publication_failed" });
    assert.equal(failed.coverage, "complete");
    assert.equal((await loadAnalyzeFinancialSections(db, { userId: IDS.owner, analyzeRunId: memo.runId }))!.coverage, "complete");
  });

  await t.test("a cancelled calculation leaves its unpublished sections as cancelled gaps", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "investment_memo" });
    await failSection("financial_health");
    try {
      await memo.publish();
    } finally {
      await restore();
    }
    const run = (await db.query(`select run_id::text from financial_runs where parent_id = $1`, [memo.runId])).rows[0];
    await requestCancellation(db, IDS.owner, run.run_id);
    const result = await memo.publish();
    assert.deepEqual(statuses(result), { financial_health: "gap:run_cancelled", cash_resilience: "published", revenue_trend: "gap:run_cancelled" });
    assert.equal(result.coverage, "partial");
    assert.deepEqual(await committed(db, memo.runId), { sections: 1, certificates: 1, plans: 1 });
  });

  await t.test("an erased run's sections read as gaps, and deleting the memo run erases its runs", async () => {
    const memo = await createMemoRun(db, pool, { templateId, playbookId: "earnings_quality" });
    assert.deepEqual(statuses(await memo.publish()), { revenue_trend: "published" });
    // What the deletion of evidence the run bound does (db/migrations/0051).
    await db.query(`delete from financial_runs where parent_kind = 'analyze_memo_run' and parent_id = $1`, [memo.runId]);
    assert.deepEqual(await committed(db, memo.runId), { sections: 0, certificates: 0, plans: 0 });
    assert.deepEqual(statuses((await loadAnalyzeFinancialSections(db, { userId: IDS.owner, analyzeRunId: memo.runId }))!), { revenue_trend: "gap:not_started" });

    const deleted = await createMemoRun(db, pool, { templateId, playbookId: "earnings_quality" });
    await deleted.publish();
    await db.query(`delete from analyze_template_runs where run_id = $1`, [deleted.runId]);
    assert.equal((await db.query(`select count(*)::int as n from financial_runs where parent_id = $1`, [deleted.runId])).rows[0].n, 0);
  });
});
