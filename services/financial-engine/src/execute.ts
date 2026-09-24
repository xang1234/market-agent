// Executes a leased run end to end: budget check, one consistent evidence
// binding, predeclared units, a pure evaluation of the pinned graph over the
// persisted bindings, then one fenced checkpoint per publication unit. Every
// step is idempotent, so a worker that takes over an expired lease re-runs
// this same function: bindings are reused (no evidence is reselected) and
// checkpointed units are skipped. Arithmetic nodes never acquire evidence.
//
// Outcomes are explicit. Cancellation is observed at every fence. Integrity
// failures (diverging re-execution, corrupt persisted bindings) fail the run.
// Anything else fails the run as internal_error and is rethrown — nothing is
// reinterpreted as missing data or partial success.

import {
  ExecutionIntegrityError,
  evaluateBoundPlan,
  nodeLineageHashes,
  summarizeCoverage,
  type CoverageSummary,
  type ExecutionLimits,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
} from "../../financial-core/src/index.ts";
import { bindPlanInputs } from "./bind-inputs.ts";
import { buildUnitCheckpoint, checkpointUnit } from "./checkpoints.ts";
import { fencedTransaction, StaleLeaseError, type RunLease } from "./lease.ts";
import { authorizePlan } from "./plan-authority.ts";
import type { FinancialEvidencePort, SqlExecutor } from "./ports.ts";
import { transitionRun } from "./run-repo.ts";
import { declareUnits } from "./unit-repo.ts";

export type ExecutionReport =
  | { run_id: string; outcome: "ready_to_seal"; coverage: CoverageSummary }
  | { run_id: string; outcome: "cancelled" }
  | { run_id: string; outcome: "failed"; failure_code: string };

export type ExecuteRunInput = {
  client: SqlExecutor;
  lease: RunLease;
  plan: FinancialPlanV1;
  authority: FinancialRuntimeAuthority;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
  parent_limits: Partial<ExecutionLimits>;
};

export async function executeRun(input: ExecuteRunInput): Promise<ExecutionReport> {
  const { client, lease, plan } = input;
  // Limits are enforced before any evidence is acquired. Evidence reads run
  // sequentially on the run's pinned client: one evidence task in flight.
  const authorized = authorizePlan(plan, input.authority, input.parent_limits);
  if (!authorized.ok) return fail(client, lease, authorized.reason_code);
  try {
    const { bindings } = await bindPlanInputs(input);
    await fencedTransaction(client, lease, (tx) => declareUnits(tx, plan));
    const evaluation = evaluateBoundPlan(plan, bindings);
    const hashes = nodeLineageHashes(plan, evaluation, bindings);
    for (const unit of plan.publication_units) {
      await checkpointUnit(client, lease, buildUnitCheckpoint(plan, evaluation, hashes, unit.unit_id));
    }
    const coverage = summarizeCoverage(evaluation);
    await fencedTransaction(client, lease, async (tx) => {
      if (tx.run.execution_state === "running") await transitionRun(tx, "ready_to_seal", { coverage_state: coverage.state });
    });
    return { run_id: lease.run_id, outcome: "ready_to_seal", coverage };
  } catch (error) {
    if (error instanceof StaleLeaseError && error.reason === "cancel_requested") {
      await fencedTransaction(client, lease, (tx) => transitionRun(tx, "cancelled"), { allowCancelRequested: true });
      return { run_id: lease.run_id, outcome: "cancelled" };
    }
    // A lost lease means another worker owns the run: nothing may be written.
    if (error instanceof StaleLeaseError) throw error;
    if (error instanceof ExecutionIntegrityError) return fail(client, lease, "integrity_failure");
    await fail(client, lease, "internal_error").catch((failure) => {
      if (!(failure instanceof StaleLeaseError)) throw failure;
    });
    throw error;
  }
}

async function fail(client: SqlExecutor, lease: RunLease, failureCode: string): Promise<ExecutionReport> {
  await fencedTransaction(client, lease, (tx) => transitionRun(tx, "failed", { failure_code: failureCode }), { allowCancelRequested: true });
  return { run_id: lease.run_id, outcome: "failed", failure_code: failureCode };
}
