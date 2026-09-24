import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { bindPlanInputs } from "../src/bind-inputs.ts";
import { buildUnitCheckpoint, checkpointUnit } from "../src/checkpoints.ts";
import { listRunEvents } from "../src/events-repo.ts";
import { createEvidenceFinancialPort } from "../src/evidence-adapter.ts";
import { executeRun } from "../src/execute.ts";
import { evaluateBoundPlan, nodeLineageHashes } from "../../financial-core/src/index.ts";
import { acquireLease, fencedTransaction, StaleLeaseError, type RunLease } from "../src/lease.ts";
import type { FinancialEvidencePort, SqlExecutor } from "../src/ports.ts";
import { loadResults } from "../src/result-repo.ts";
import { declareUnits, listUnits } from "../src/unit-repo.ts";
import { authorityFor, engineDatabase, IDS, leasedRun, marginPlan } from "./db-fixtures.ts";

test("execution recovery after a worker crash", { timeout: 240_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for execution recovery coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-recovery");
  const authority = authorityFor();
  const plan = marginPlan();
  const { runId, lease: crashed } = await leasedRun(db, plan, authority, "worker-1");

  // Worker 1 binds, declares, checkpoints the independent revenue unit, then dies.
  let evidenceReads = 0;
  const counting = (executor: SqlExecutor): FinancialEvidencePort => {
    const real = createEvidenceFinancialPort(executor);
    return { listInputCandidates: (request) => { evidenceReads += 1; return real.listInputCandidates(request); } };
  };
  const { bindings } = await bindPlanInputs({ client: db, lease: crashed, plan, authority, evidence: counting });
  assert.equal(evidenceReads, 4);
  await fencedTransaction(db, crashed, (tx) => declareUnits(tx, plan));
  const evaluation = evaluateBoundPlan(plan, bindings);
  const hashes = nodeLineageHashes(plan, evaluation, bindings);
  assert.equal(await checkpointUnit(db, crashed, buildUnitCheckpoint(plan, evaluation, hashes, "rev_unit")), true);
  const checkpointed = await loadResults(db, runId);
  assert.deepEqual(checkpointed.map((result) => result.output_id), ["out_rev", "out_rev22"]);

  // The lease expires; worker 2 takes over with a higher epoch and resumes.
  await db.query(`update financial_runs set lease_expires_at = now() - interval '1 second' where run_id = $1`, [runId]);
  const acquired = await acquireLease(db, { authority, run_id: runId, worker_id: "worker-2", ttl_ms: 60_000 });
  assert.ok(acquired.status === "acquired");
  const resumed = (acquired as { lease: RunLease }).lease;
  assert.equal(resumed.epoch, 2);
  const noEvidence = () => ({ listInputCandidates: async () => assert.fail("a resumed run must reuse its bindings, never reselect evidence") });
  const report = await executeRun({ client: db, lease: resumed, plan, authority, evidence: noEvidence, parent_limits: {} });
  assert.equal(report.outcome, "ready_to_seal");

  await t.test("the checkpointed unit is kept exactly; the rest completes once", async () => {
    const results = await loadResults(db, runId);
    assert.deepEqual(results.map((result) => result.output_id), ["out_check", "out_gm", "out_gm22", "out_rev", "out_rev22"]);
    for (const before of checkpointed) {
      assert.deepEqual(results.find((result) => result.output_id === before.output_id), before, `${before.output_id} is untouched`);
    }
    const perNode = (await db.query(`select node_id, count(*)::int as n from computations where financial_run_id = $1 group by node_id order by node_id`, [runId])).rows;
    assert.deepEqual(perNode, [{ node_id: "a_gm", n: 1 }, { node_id: "a_gm_check", n: 1 }]);
    const events = await listRunEvents(db, { owner_user_id: IDS.owner, run_id: runId, after_sequence: 0, limit: 50 });
    assert.deepEqual(events.filter((event) => event.event_kind === "unit_computed").map((event) => event.unit_id), ["rev_unit", "margin_unit", "screen_unit"]);
    assert.equal(events.filter((event) => event.event_kind === "inputs_bound").length, 1);
  });

  await t.test("the crashed worker's stale epoch cannot write", async () => {
    const stale = buildUnitCheckpoint(plan, evaluation, hashes, "margin_unit");
    await assert.rejects(() => checkpointUnit(db, crashed, stale), StaleLeaseError);
    await assert.rejects(() => executeRun({ client: db, lease: crashed, plan, authority, evidence: createEvidenceFinancialPort, parent_limits: {} }), StaleLeaseError);
    const run = (await db.query(`select execution_state, lease_owner, lease_epoch::int from financial_runs where run_id = $1`, [runId])).rows[0];
    assert.deepEqual(run, { execution_state: "ready_to_seal", lease_owner: "worker-2", lease_epoch: 2 });
    assert.ok((await listUnits(db, runId)).every((unit) => unit.state === "computed"));
  });
});
