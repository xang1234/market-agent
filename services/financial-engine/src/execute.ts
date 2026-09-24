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
  evaluatePlan,
  operandFromBoundInput,
  operationGap,
  summarizeCoverage,
  type CoverageSummary,
  type ExecutionLimits,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
  type GraphEvaluation,
  type LocalId,
  type ReasonCode,
} from "../../financial-core/src/index.ts";
import { bindPlanInputs, type InputBinding } from "./bind-inputs.ts";
import { buildUnitCheckpoint, checkpointUnit, nodeHashes } from "./checkpoints.ts";
import { ExecutionIntegrityError } from "./errors.ts";
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
    const hashes = nodeHashes(plan, evaluation, bindings);
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

/** Pure evaluation of the plan over persisted bindings. */
export function evaluateBoundPlan(plan: FinancialPlanV1, bindings: ReadonlyMap<LocalId, InputBinding>): GraphEvaluation {
  const definitions = new Map(plan.metric_definitions.map((entry) => [entry.metric_key, entry.definition_version]));
  const slots = new Map(plan.subjects.members.map((member) => [member.slot_id, member]));
  return evaluatePlan(plan, (node) => {
    const binding = bindings.get(node.node_id);
    if (!binding) throw new ExecutionIntegrityError(`reported node ${node.node_id} has no persisted binding`);
    if (binding.status === "gap") return operationGap(binding.reason_code, bindingGapExplanation(binding.reason_code));
    return operandFromBoundInput(binding.input, node, { slot: slots.get(node.subject_slot)!, definition_version: definitions.get(node.metric_key)! });
  });
}

function bindingGapExplanation(reason: ReasonCode): string {
  switch (reason) {
    case "database_error":
    case "provider_error":
      return "The evidence read failed; this input is unknown, not absent.";
    case "scope_limit_exceeded":
      return "The evidence search exceeded the request's limits.";
    case "conflicting_evidence":
      return "Eligible sources disagree on this value.";
    default:
      return "No eligible input was public before the knowledge cutoff.";
  }
}

async function fail(client: SqlExecutor, lease: RunLease, failureCode: string): Promise<ExecutionReport> {
  await fencedTransaction(client, lease, (tx) => transitionRun(tx, "failed", { failure_code: failureCode }), { allowCancelRequested: true });
  return { run_id: lease.run_id, outcome: "failed", failure_code: failureCode };
}
