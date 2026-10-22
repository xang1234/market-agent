import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client } from "pg";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { hashCanonical } from "../../financial-core/src/index.ts";
import type { SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { bindPlanInputs } from "../src/bind-inputs.ts";
import { createEvidenceFinancialPort } from "../src/evidence-adapter.ts";
import { executeRun } from "../src/execute.ts";
import { finalizeUnit } from "../src/finalize.ts";
import type { FinancialEvidencePort } from "../src/ports.ts";
import { readRunStatus } from "../src/read-model.ts";
import { reserveReplayRun } from "../src/run-repo.ts";
import { FINANCIAL_VERSION_REGISTRY } from "../src/version-registry.ts";
import { createFinancialWorker, type WorkerPool } from "../src/worker.ts";
import { authorityFor, completedRun, databaseUrl, engineDatabase, IDS, leasedRun, marginPlan, pinnedClients } from "./db-fixtures.ts";

/** Evidence that fails the test if a replay ever asks for it. */
const noEvidence = (): FinancialEvidencePort => ({
  listInputCandidates: async () => assert.fail("a replay must never select evidence"),
  readSplitHistory: async () => assert.fail("a replay must never select evidence"),
  readPriceObservations: async () => assert.fail("a replay must never select evidence"),
});

async function bypass(db: Client, sql: string, params: unknown[]): Promise<void> {
  await db.query("begin");
  await db.query("set local session_replication_role = replica");
  await db.query(sql, params);
  await db.query("commit");
}

test("pinned verification replay", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for replay coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-replay");
  const [client] = await pinnedClients(t, db, 1) as [SnapshotTransactionClient];
  const pool = await connectedPool(t, databaseUrl(db));
  const worker = (registry = FINANCIAL_VERSION_REGISTRY) =>
    createFinancialWorker({ pool, worker_id: "replayer", ttl_ms: 60_000, evidence: noEvidence, parents: {}, registry, interval_ms: 1_000, max_runs_per_tick: 10 });
  const replayOf = async (runId: string) => {
    const reserved = await reserveReplayRun(client, { owner_user_id: IDS.owner, source_run_id: runId, request_key: randomUUID() });
    assert.equal(reserved.status, "created");
    return (reserved as { run: { run_id: string } }).run.run_id;
  };
  const certificates = async () => (await db.query(`select count(*)::int as n from snapshot_financial_runs`)).rows[0].n as number;

  await t.test("a saved run recomputes to the same results after newer evidence arrives, with no evidence or model calls", async () => {
    const original = await completedRun(db, client);
    await db.query(
      `insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                          value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, verification_status,
                          freshness_class, coverage_level, confidence)
       values ($1, 'issuer', $2, $3, 'fiscal_y', '2023-01-01', '2023-12-31', 2023, 'FY', 999999999999, 'currency', 'USD', 1,
               now(), now(), now(), $4, 'reported', 'authoritative', 'filing_time', 'full', 1)`,
      [randomUUID(), IDS.issuerA, IDS.grossProfit, IDS.sourceV2],
    );
    const before = await certificates();
    const replayId = await replayOf(original.runId);
    const entries = await worker().tick();
    const entry = entries.find((candidate) => candidate.run_id === replayId);
    assert.ok(entry && entry.status === "replayed" && entry.replay.status === "verified", JSON.stringify(entries));
    assert.deepEqual(entry.replay.verified_outputs, ["out_check", "out_gm", "out_gm22", "out_rev", "out_rev22"]);
    const status = await readRunStatus(db, IDS.owner, replayId);
    assert.deepEqual([status?.execution_state, status?.coverage_state, status?.replay_of_run_id], ["completed", "partial", original.runId]);
    assert.equal(await certificates(), before, "a replay never issues a certificate");
    assert.deepEqual((await worker().tick()).filter((candidate) => candidate.run_id === replayId), [], "a finished replay is not picked up again");
  });

  await t.test("a run bound under selection v5 still passes the seal and replays as verified after selection moved to v6 (#481)", async () => {
    const plan = marginPlan();
    const authority = authorityFor();
    const { runId, lease } = await leasedRun(db, plan, authority);
    await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort });
    const policies = async () => (await db.query(`select distinct selection_policy_version from financial_run_inputs where run_id = $1`, [runId])).rows;
    assert.deepEqual(await policies(), [{ selection_policy_version: "public-information-selection.v6" }]);
    const rows = (await db.query<{ input_slot: string; bound_payload: { eligibility: { selection_policy_version: string } } | null }>(
      `select input_slot, bound_payload from financial_run_inputs where run_id = $1`, [runId])).rows;
    for (const row of rows) {
      const payload = row.bound_payload && { ...row.bound_payload, eligibility: { ...row.bound_payload.eligibility, selection_policy_version: "public-information-selection.v5" } };
      await bypass(db, `update financial_run_inputs set selection_policy_version = 'public-information-selection.v5', bound_payload = $3::jsonb, payload_hash = $4
                         where run_id = $1 and input_slot = $2`, [runId, row.input_slot, payload && JSON.stringify(payload), payload && hashCanonical("bound_input", payload)]);
    }
    assert.deepEqual(await policies(), [{ selection_policy_version: "public-information-selection.v5" }]);
    assert.equal((await executeRun({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort, parent_limits: {} })).outcome, "ready_to_seal");
    for (const unit of plan.publication_units) {
      const outcome = await finalizeUnit({ client, lease, authority, unit_id: unit.unit_id, snapshot_id: randomUUID(), persistParent: async () => {} });
      assert.equal(outcome.status, "published", JSON.stringify(outcome));
    }
    const replayId = await replayOf(runId);
    const entry = (await worker().tick()).find((candidate) => candidate.run_id === replayId);
    assert.ok(entry && entry.status === "replayed" && entry.replay.status === "verified", JSON.stringify(entry));
  });

  await t.test("a historical version this build does not ship is unavailable, not reinterpreted", async () => {
    const original = await completedRun(db, client);
    const replayId = await replayOf(original.runId);
    const withoutMargin = { ...FINANCIAL_VERSION_REGISTRY, operation_versions: new Set([...FINANCIAL_VERSION_REGISTRY.operation_versions].filter((version) => version !== "gross_margin.v1")) };
    const entry = (await worker(withoutMargin).tick()).find((candidate) => candidate.run_id === replayId);
    assert.ok(entry && entry.status === "replayed");
    assert.deepEqual(entry.replay, { status: "failed", run_id: replayId, reason_code: "replay_version_unavailable", output_ids: [] });
    const status = await readRunStatus(db, IDS.owner, replayId);
    assert.deepEqual([status?.execution_state, status?.reason_code], ["failed", "replay_version_unavailable"]);
  });

  await t.test("evidence revoked since the original makes verification unavailable, never a fresh certificate", async () => {
    const original = await completedRun(db, client);
    const replayId = await replayOf(original.runId);
    const before = await certificates();
    await db.query(`update facts set invalidated_at = now() where fact_id = $1`, [IDS.grossProfit2023]);
    try {
      const entry = (await worker().tick()).find((candidate) => candidate.run_id === replayId);
      assert.ok(entry && entry.status === "replayed" && entry.replay.status === "failed" && entry.replay.reason_code === "replay_evidence_unavailable", JSON.stringify(entry));
    } finally {
      await db.query(`update facts set invalidated_at = null where fact_id = $1`, [IDS.grossProfit2023]);
    }
    assert.equal(await certificates(), before);
  });

  await t.test("a committed result that no longer recomputes is reported by output", async () => {
    const original = await completedRun(db, client);
    const replayId = await replayOf(original.runId);
    await bypass(db, `update financial_results set result_hash = $2 where run_id = $1 and output_id = 'out_gm'`, [original.runId, "0".repeat(64)]);
    const entry = (await worker().tick()).find((candidate) => candidate.run_id === replayId);
    assert.ok(entry && entry.status === "replayed");
    assert.deepEqual(entry.replay, { status: "failed", run_id: replayId, reason_code: "replay_mismatch", output_ids: ["out_gm"] });
  });
});
