// Dependency propagation, publication-unit isolation, and output coverage.
//
// * Every requested output receives a state; missing rows never vanish.
// * Ordinary gaps block downstream nodes (blocked_dependency). peer_compare
//   alone tolerates members missing for evidence reasons and reports an
//   incomplete cohort; execution failures are never tolerated as "missing".
// * A FinancialIntegrityError rejects every predeclared unit whose closure
//   contains the failing node; unaffected units continue.
// * Any other exception is run-fatal and propagates. Nothing is caught and
//   reinterpreted as missing data.
// * Coverage (complete/partial/none) is measured against requested outputs
//   and is independent of execution status.

import {
  GAP_DISPOSITIONS,
  operationDependencies,
  type CoverageState,
  type FinancialPlanV1,
  type GapDisposition,
  type LocalId,
  type OperationNode,
  type ReasonCode,
  type SuccessPayload,
} from "./contracts.ts";
import { dependencyClosure, topologicalOrder } from "./graph.ts";
import { evaluateOperation, OPERATION_REGISTRY, type ReportedMetricEvaluator } from "./operation-registry.ts";
import { FinancialIntegrityError, type FinancialOperand, type OperationOutcome } from "./operations.ts";
import { unitClosures } from "./publication-units.ts";

export type NodeState =
  | { status: "computed"; payload: SuccessPayload; operand: FinancialOperand | null }
  | {
      status: "gap";
      disposition: GapDisposition;
      reason_code: ReasonCode;
      explanation: string;
      /** Whether the root cause is absent/unusable evidence or a failed execution. */
      cause: "evidence" | "execution";
    }
  | { status: "integrity_failure"; code: string; explanation: string };

export type OutputOutcome = {
  output_id: LocalId;
  node_id: LocalId;
  unit_id: LocalId;
  state: NodeState;
  unit_rejected: boolean;
};

export type UnitOutcome = { unit_id: LocalId; state: "computed" | "rejected"; output_ids: LocalId[] };

export type GraphEvaluation = {
  nodes: ReadonlyMap<LocalId, NodeState>;
  outputs: OutputOutcome[];
  units: UnitOutcome[];
};

export type CoverageSummary = {
  state: CoverageState;
  requested: number;
  computed: number;
  gaps: number;
  execution_errors: number;
  rejected: number;
  by_disposition: Record<GapDisposition, number>;
};

export function evaluatePlan(plan: FinancialPlanV1, reported: ReportedMetricEvaluator): GraphEvaluation {
  const needed = dependencyClosure(plan, plan.outputs.map((output) => output.node_id));
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const states = new Map<LocalId, NodeState>();

  for (const nodeId of topologicalOrder(plan)) {
    if (!needed.has(nodeId)) continue;
    states.set(nodeId, evaluateNode(nodes.get(nodeId)!, states, { plan, reported }));
  }

  const units: UnitOutcome[] = [...unitClosures(plan).values()].map((closure) => ({
    unit_id: closure.unit_id,
    state: closure.node_ids.some((nodeId) => states.get(nodeId)?.status === "integrity_failure") ? "rejected" : "computed",
    output_ids: [...closure.output_ids],
  }));
  const rejectedUnits = new Set(units.filter((unit) => unit.state === "rejected").map((unit) => unit.unit_id));
  const outputs = plan.outputs.map((output) => ({
    output_id: output.output_id,
    node_id: output.node_id,
    unit_id: output.unit_id,
    state: states.get(output.node_id)!,
    unit_rejected: rejectedUnits.has(output.unit_id),
  }));
  return { nodes: states, outputs, units };
}

export function summarizeCoverage(evaluation: GraphEvaluation): CoverageSummary {
  const byDisposition = Object.fromEntries(GAP_DISPOSITIONS.map((disposition) => [disposition, 0])) as Record<GapDisposition, number>;
  let computed = 0;
  let rejected = 0;
  for (const output of evaluation.outputs) {
    if (output.unit_rejected) rejected += 1;
    else if (output.state.status === "computed") computed += 1;
    else if (output.state.status === "gap") byDisposition[output.state.disposition] += 1;
  }
  const requested = evaluation.outputs.length;
  const gaps = Object.values(byDisposition).reduce((total, count) => total + count, 0);
  return {
    state: computed === requested ? "complete" : computed === 0 ? "none" : "partial",
    requested,
    computed,
    gaps,
    execution_errors: byDisposition.execution_error,
    rejected,
    by_disposition: byDisposition,
  };
}

/**
 * Quantified statement over threshold outputs. "all" is true only when every
 * member is known true, and false as soon as one known member fails; "any"
 * is true with one known witness and false only when every member is known
 * false. Otherwise the statement is withheld as an incomplete cohort.
 */
export function cohortAssertion(
  evaluation: GraphEvaluation,
  outputIds: ReadonlyArray<LocalId>,
  quantifier: "all" | "any",
): { holds: boolean } | { holds: null; reason_code: "incomplete_cohort" } {
  const outcomes = outputIds.map((outputId) => {
    const output = evaluation.outputs.find((entry) => entry.output_id === outputId);
    if (!output) throw new RangeError(`unknown output ${outputId}`);
    if (output.unit_rejected || output.state.status !== "computed") return null;
    if (output.state.payload.kind !== "predicate") throw new RangeError(`output ${outputId} is not a predicate`);
    return output.state.payload.outcome;
  });
  const decisive = quantifier === "all" ? false : true;
  if (outcomes.includes(decisive)) return { holds: decisive };
  if (outcomes.includes(null)) return { holds: null, reason_code: "incomplete_cohort" };
  return { holds: !decisive };
}

/** Explicit truncation: callers must disclose omitted_count, never imply completeness. */
export function capPopulation<T>(items: ReadonlyArray<T>, cap: number): { items: T[]; omitted_count: number; truncated: boolean } {
  if (!Number.isSafeInteger(cap) || cap < 1) throw new RangeError("cap must be a positive integer");
  const kept = items.slice(0, cap);
  return { items: kept, omitted_count: items.length - kept.length, truncated: kept.length < items.length };
}

function evaluateNode(
  node: OperationNode,
  states: ReadonlyMap<LocalId, NodeState>,
  context: Parameters<typeof evaluateOperation>[2],
): NodeState {
  const dependencies = operationDependencies(node).map((dependency) => states.get(dependency)!);
  for (const state of dependencies) {
    if (state.status === "integrity_failure") {
      return { status: "integrity_failure", code: state.code, explanation: "Depends on an input that failed integrity checks." };
    }
  }
  const tolerant = OPERATION_REGISTRY[node.operation].tolerates_missing_operands;
  for (const state of dependencies) {
    if (state.status === "gap" && (!tolerant || state.cause === "execution")) {
      return {
        status: "gap",
        disposition: "blocked_dependency",
        reason_code: "blocked_by_dependency",
        explanation: "A required input or calculation is unavailable.",
        cause: state.cause,
      };
    }
  }
  const operands = dependencies.map((state) => {
    if (state.status !== "computed") return null;
    if (state.operand === null) throw new Error(`node ${node.node_id} uses a predicate as an operand`);
    return state.operand;
  });

  let outcome: OperationOutcome;
  try {
    outcome = evaluateOperation(node, operands, context);
  } catch (error) {
    if (error instanceof FinancialIntegrityError) {
      return { status: "integrity_failure", code: error.code, explanation: "A bound input failed integrity checks." };
    }
    throw error;
  }
  if (!outcome.ok) {
    return {
      status: "gap",
      disposition: outcome.disposition,
      reason_code: outcome.reason_code,
      explanation: outcome.explanation,
      cause: outcome.disposition === "execution_error" ? "execution" : "evidence",
    };
  }
  return { status: "computed", payload: outcome.payload, operand: outcome.operand };
}
