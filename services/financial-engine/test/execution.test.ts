import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { FinancialPlanV1 } from "../../financial-core/src/index.ts";
import { bindPlanInputs } from "../src/bind-inputs.ts";
import { buildUnitCheckpoint, checkpointUnit, nodeHashes } from "../src/checkpoints.ts";
import { listRunEvents } from "../src/events-repo.ts";
import { createEvidenceFinancialPort } from "../src/evidence-adapter.ts";
import { evaluateBoundPlan, executeRun } from "../src/execute.ts";
import { fencedTransaction } from "../src/lease.ts";
import type { FinancialEvidencePort, SqlExecutor } from "../src/ports.ts";
import { loadResults } from "../src/result-repo.ts";
import { requestCancellation } from "../src/run-repo.ts";
import { declareUnits, listUnits } from "../src/unit-repo.ts";
import { authorityFor, engineDatabase, IDS, leasedRun, marginPlan, ORIGINAL_REVENUE, revenuePlan } from "./db-fixtures.ts";

const authority = authorityFor();

function run(db: Client, plan: FinancialPlanV1, lease: Parameters<typeof executeRun>[0]["lease"], evidence = createEvidenceFinancialPort) {
  return executeRun({ client: db, lease, plan, authority, evidence, parent_limits: {} });
}

async function resultsByOutput(db: Client, runId: string) {
  return new Map((await loadResults(db, runId)).map((result) => [result.output_id, result]));
}

async function runRow(db: Client, runId: string) {
  return (await db.query(`select execution_state, coverage_state, failure_code, lease_owner from financial_runs where run_id = $1`, [runId])).rows[0];
}

/** Evidence whose reads for one metric-year fail inside the database, leaving the transaction aborted. */
function failingEvidence(metric: string, fiscalYear: number) {
  return (executor: SqlExecutor): FinancialEvidencePort => {
    const real = createEvidenceFinancialPort(executor);
    return {
      listInputCandidates: async (request) => {
        if (request.metric_key !== metric || request.fiscal_year !== fiscalYear) return real.listInputCandidates(request);
        try {
          await executor.query("select * from financial_relation_that_does_not_exist");
        } catch {
          return { status: "error", reason_code: "database_error" };
        }
        throw new Error("the failing read unexpectedly succeeded");
      },
    };
  };
}

test("bounded financial graph execution", { timeout: 240_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for execution coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-execute");

  await t.test("missing gross profit blocks its margin, not revenue; the empty screen is complete", async () => {
    const plan = marginPlan();
    const { runId, lease } = await leasedRun(db, plan);
    const report = await run(db, plan, lease);
    assert.equal(report.outcome, "ready_to_seal");
    assert.ok(report.outcome === "ready_to_seal");
    assert.deepEqual([report.coverage.state, report.coverage.requested, report.coverage.computed], ["partial", 5, 4]);

    const results = await resultsByOutput(db, runId);
    assert.deepEqual([...results.keys()].sort(), ["out_check", "out_gm", "out_gm22", "out_rev", "out_rev22"], "every requested output has a row");
    assert.ok([...results.values()].every((result) => result.state === "draft"), "execution never awards verified");
    assert.deepEqual(results.get("out_rev")!.payload, { kind: "value", value: ORIGINAL_REVENUE, unit: { kind: "currency", currency: "USD" }, exact: true, rounding: null });
    assert.equal(results.get("out_rev22")!.disposition, "computed");
    assert.equal(results.get("out_gm")!.disposition, "computed");
    assert.deepEqual(results.get("out_gm")!.dependencies, ["a_rev", "a_gp"]);
    assert.deepEqual([results.get("out_gm22")!.disposition, (results.get("out_gm22")!.payload as { reason_code: string }).reason_code], ["blocked_dependency", "blocked_by_dependency"]);
    assert.deepEqual(results.get("out_check")!.payload, { kind: "predicate", predicate: "threshold", comparison: "gte", outcome: false });

    const computations = (await db.query(`select node_id, computation_id::text from computations where financial_run_id = $1 order by node_id`, [runId])).rows;
    assert.deepEqual(computations.map((row) => row.node_id), ["a_gm", "a_gm_check"], "only computed derived nodes have computations");
    assert.equal(results.get("out_gm")!.computation_id, computations[0].computation_id);
    assert.equal(results.get("out_rev")!.computation_id, null, "a reported value's lineage is its binding");

    assert.deepEqual((await listUnits(db, runId)).map((unit) => [unit.unit_id, unit.state, unit.coverage_state]), [
      ["margin_unit", "computed", "partial"],
      ["rev_unit", "computed", "complete"],
      ["screen_unit", "computed", "complete"],
    ]);
    assert.deepEqual(await runRow(db, runId), { execution_state: "ready_to_seal", coverage_state: "partial", failure_code: null, lease_owner: "worker-1" });
    const events = await listRunEvents(db, { owner_user_id: IDS.owner, run_id: runId, after_sequence: 0, limit: 50 });
    assert.deepEqual(events.find((event) => event.event_kind === "inputs_bound")?.payload, { bound_count: 3, gap_count: 1 });
  });

  await t.test("a zero-covered answer is distinct from a complete one", async () => {
    const plan = revenuePlan({ subjects: ["b"] });
    const { runId, lease } = await leasedRun(db, plan);
    const report = await run(db, plan, lease);
    assert.ok(report.outcome === "ready_to_seal");
    assert.deepEqual([report.coverage.state, report.coverage.computed, report.coverage.by_disposition.missing], ["none", 0, 2]);
    assert.deepEqual([...(await resultsByOutput(db, runId)).values()].map((result) => result.disposition), ["missing", "missing"]);
    assert.deepEqual(await listUnits(db, runId).then((units) => units.map((unit) => unit.coverage_state)), ["none"]);
    assert.equal((await runRow(db, runId)).coverage_state, "none");
  });

  await t.test("a failed evidence read is an execution error, not absent evidence", async () => {
    const plan = revenuePlan();
    const { runId, lease } = await leasedRun(db, plan);
    const report = await run(db, plan, lease, failingEvidence("revenue", 2023));
    assert.ok(report.outcome === "ready_to_seal");
    assert.equal(report.coverage.execution_errors, 1);
    const results = await resultsByOutput(db, runId);
    assert.deepEqual([results.get("a_out_rev")!.disposition, (results.get("a_out_rev")!.payload as { reason_code: string }).reason_code], ["execution_error", "database_error"]);
    assert.equal(results.get("a_out_prev")!.disposition, "computed", "the binding transaction survives the failed read");
  });

  await t.test("re-executing a pinned graph yields identical values and hashes and writes nothing twice", async () => {
    const plan = marginPlan();
    const first = await leasedRun(db, plan);
    const pinned = { ...plan, plan_id: randomUUID() };
    const second = await leasedRun(db, pinned);
    assert.equal((await run(db, plan, first.lease)).outcome, "ready_to_seal");
    assert.equal((await run(db, pinned, second.lease)).outcome, "ready_to_seal");
    const summary = async (runId: string) =>
      (await loadResults(db, runId)).map((result) => [result.output_id, result.disposition, result.payload, result.result_hash]);
    assert.deepEqual(await summary(first.runId), await summary(second.runId));
    const outputHashes = async (runId: string) =>
      (await db.query(`select node_id, output_hash from computations where financial_run_id = $1 order by node_id`, [runId])).rows;
    assert.deepEqual(await outputHashes(first.runId), await outputHashes(second.runId));

    const before = await loadResults(db, first.runId);
    const again = await run(db, plan, first.lease);
    assert.equal(again.outcome, "ready_to_seal");
    assert.deepEqual(await loadResults(db, first.runId), before, "no new or changed rows");
    const unitEvents = (await listRunEvents(db, { owner_user_id: IDS.owner, run_id: first.runId, after_sequence: 0, limit: 50 }))
      .filter((event) => event.event_kind === "unit_computed" || event.event_kind === "run_ready_to_seal");
    assert.equal(unitEvents.length, 4, "three units and one ready transition, no duplicates");
  });

  await t.test("cancellation is observed between units", async () => {
    const plan = marginPlan();
    const { runId, lease } = await leasedRun(db, plan);
    const { bindings } = await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort });
    await fencedTransaction(db, lease, (tx) => declareUnits(tx, plan));
    const evaluation = evaluateBoundPlan(plan, bindings);
    await checkpointUnit(db, lease, buildUnitCheckpoint(plan, evaluation, nodeHashes(plan, evaluation, bindings), "rev_unit"));

    await requestCancellation(db, IDS.owner, runId);
    assert.deepEqual(await run(db, plan, lease), { run_id: runId, outcome: "cancelled" });
    assert.deepEqual((await listUnits(db, runId)).map((unit) => [unit.unit_id, unit.state]), [["margin_unit", "pending"], ["rev_unit", "computed"], ["screen_unit", "pending"]]);
    assert.deepEqual([...(await resultsByOutput(db, runId)).keys()].sort(), ["out_rev", "out_rev22"]);
    assert.deepEqual(await runRow(db, runId), { execution_state: "cancelled", coverage_state: null, failure_code: null, lease_owner: null });
  });

  await t.test("limits are enforced before any evidence is acquired", async () => {
    const plan = marginPlan();
    const { runId, lease } = await leasedRun(db, plan);
    const untouchable = () => ({ listInputCandidates: async () => assert.fail("evidence must not be read over budget") });
    const report = await executeRun({ client: db, lease, plan, authority, evidence: untouchable, parent_limits: { max_outputs: 4 } });
    assert.deepEqual(report, { run_id: runId, outcome: "failed", failure_code: "scope_limit_exceeded" });
    assert.equal((await db.query(`select count(*)::int as n from financial_run_inputs where run_id = $1`, [runId])).rows[0].n, 0);
    assert.equal((await runRow(db, runId)).execution_state, "failed");
  });

  await t.test("an existing result with a different payload fails the run instead of being overwritten", async () => {
    const plan = revenuePlan();
    const { runId, lease } = await leasedRun(db, plan);
    await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort });
    await fencedTransaction(db, lease, async (tx) => {
      await declareUnits(tx, plan);
      await tx.client.query(
        `insert into financial_results (run_id, output_id, node_id, unit_id, state, disposition, payload, dependencies, result_hash)
         values ($1, 'a_out_rev', 'a_rev', 'a_unit', 'draft', 'missing', '{"kind":"gap","reason_code":"missing_input","explanation":"x"}', '[]', $2)`,
        [runId, "e".repeat(64)],
      );
    });
    assert.deepEqual(await run(db, plan, lease), { run_id: runId, outcome: "failed", failure_code: "integrity_failure" });
    assert.deepEqual((await listUnits(db, runId)).map((unit) => unit.state), ["pending"], "the unit's checkpoint rolled back");
    assert.equal((await resultsByOutput(db, runId)).get("a_out_prev"), undefined);
  });

  await t.test("an unexpected error fails the run and propagates; it is never partial success", async () => {
    const plan = revenuePlan();
    const { runId, lease } = await leasedRun(db, plan);
    const broken = () => ({ listInputCandidates: async () => { throw new Error("adapter bug"); } });
    await assert.rejects(() => executeRun({ client: db, lease, plan, authority, evidence: broken, parent_limits: {} }), /adapter bug/);
    assert.deepEqual(await runRow(db, runId), { execution_state: "failed", coverage_state: null, failure_code: "internal_error", lease_owner: null });
    assert.equal((await db.query(`select count(*)::int as n from financial_run_inputs where run_id = $1`, [runId])).rows[0].n, 0);
  });
});
