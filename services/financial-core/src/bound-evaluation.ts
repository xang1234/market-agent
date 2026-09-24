// Evaluation of a pinned plan over its bound inputs, and everything a
// publication unit derives from that evaluation: node lineage hashes,
// computation records, and requested-output results with their hashes.
//
// This is the single definition of "what a run computes". The engine uses it
// to write draft checkpoints; the snapshot verifier uses it to recompute those
// checkpoints independently from database records at the publication boundary.
// Pure: no database, clock, randomness, or engine imports.

import { canonicalJson, hashCanonical } from "./canonical.ts";
import type {
  BoundFinancialInputV1,
  CoverageState,
  FinancialPlanV1,
  GapDisposition,
  GapPayload,
  LocalId,
  ReasonCode,
  Sha256Hex,
  SuccessPayload,
} from "./contracts.ts";
import { operationDependencies } from "./contracts.ts";
import { coverageState, evaluatePlan, type GraphEvaluation, type NodeState } from "./coverage.ts";
import { dependencyClosure, topologicalOrder } from "./graph.ts";
import { NUMERIC_POLICY } from "./numeric-policy.ts";
import { OPERATION_REGISTRY } from "./operation-registry.ts";
import { operandFromBoundInput, operationGap } from "./operations.ts";
import { unitClosures } from "./publication-units.ts";

/**
 * A persisted, contradictory, or incomplete execution record: a missing
 * binding, a unit the plan does not declare, a re-execution that diverges
 * from its checkpoint. Never reinterpreted as missing data.
 */
export class ExecutionIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionIntegrityError";
  }
}

/** One reported-metric slot as bound: an immutable input, or an explicit gap. */
export type SlotBinding =
  | Readonly<{ status: "bound"; input: BoundFinancialInputV1; payload_hash: Sha256Hex; candidate_set_digest: Sha256Hex }>
  | Readonly<{ status: "gap"; reason_code: ReasonCode; candidate_set_digest: Sha256Hex }>;

/** A derived node's computation, as persisted in `computations`. */
export type ComputationRecord = Readonly<{
  node_id: LocalId;
  operation: string;
  operation_version: string;
  numeric_policy_version: string;
  definition_versions: Readonly<Record<string, string>>;
  input_refs: ReadonlyArray<Readonly<{ node_id: LocalId; hash: Sha256Hex }>>;
  output_hash: Sha256Hex;
}>;

/** A requested output's result, before any persistence identity is assigned. */
export type ExpectedResult = Readonly<{
  output_id: LocalId;
  node_id: LocalId;
  unit_id: LocalId;
  dependencies: ReadonlyArray<LocalId>;
  disposition: "computed" | GapDisposition;
  payload: SuccessPayload | GapPayload;
  result_hash: Sha256Hex;
}>;

export type UnitPublication = Readonly<{
  unit_id: LocalId;
  rejected: boolean;
  coverage: CoverageState;
  computations: ReadonlyArray<ComputationRecord>;
  results: ReadonlyArray<ExpectedResult>;
}>;

const REJECTED_EXPLANATION = "An input to this section failed integrity checks, so the section was withheld.";

/** Evaluates the plan over its bindings. Every reported node must have a binding. */
export function evaluateBoundPlan(plan: FinancialPlanV1, bindings: ReadonlyMap<LocalId, SlotBinding>): GraphEvaluation {
  const definitions = new Map(plan.metric_definitions.map((entry) => [entry.metric_key, entry.definition_version]));
  const slots = new Map(plan.subjects.members.map((member) => [member.slot_id, member]));
  return evaluatePlan(plan, (node) => {
    const binding = bindings.get(node.node_id);
    if (!binding) throw new ExecutionIntegrityError(`reported node ${node.node_id} has no binding`);
    if (binding.status === "gap") return operationGap(binding.reason_code, bindingGapExplanation(binding.reason_code));
    return operandFromBoundInput(binding.input, node, { slot: slots.get(node.subject_slot)!, definition_version: definitions.get(node.metric_key)! });
  });
}

/**
 * Lineage hash of every evaluated node, in topological order. A bound
 * reported input is identified by its bound payload hash; every other node by
 * its operation, its inputs' hashes, and its outcome.
 */
export function nodeLineageHashes(
  plan: FinancialPlanV1,
  evaluation: GraphEvaluation,
  bindings: ReadonlyMap<LocalId, SlotBinding>,
): Map<LocalId, Sha256Hex> {
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const hashes = new Map<LocalId, Sha256Hex>();
  for (const nodeId of topologicalOrder(plan)) {
    const state = evaluation.nodes.get(nodeId);
    if (!state) continue;
    const node = nodes.get(nodeId)!;
    const binding = node.operation === "reported_metric" ? bindings.get(nodeId) : undefined;
    if (binding?.status === "bound" && state.status === "computed") {
      hashes.set(nodeId, binding.payload_hash);
      continue;
    }
    hashes.set(nodeId, hashCanonical("computation", {
      node_id: nodeId,
      operation: node.operation,
      operation_version: node.operation_version,
      binding: binding ? { status: binding.status, candidate_set_digest: binding.candidate_set_digest } : null,
      inputs: operationDependencies(node).map((dependency) => ({ node_id: dependency, hash: hashes.get(dependency)! })),
      outcome: stateDigest(state),
    }));
  }
  return hashes;
}

/** Everything a publication unit derives from the evaluation. */
export function unitPublication(
  plan: FinancialPlanV1,
  evaluation: GraphEvaluation,
  hashes: ReadonlyMap<LocalId, Sha256Hex>,
  unitId: LocalId,
): UnitPublication {
  const closure = unitClosures(plan).get(unitId);
  const unit = evaluation.units.find((entry) => entry.unit_id === unitId);
  if (!closure || !unit) throw new ExecutionIntegrityError(`unit ${unitId} is not declared by the plan`);
  const rejected = unit.state === "rejected";
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const order = topologicalOrder(plan);

  const computations = rejected ? [] : closure.node_ids.flatMap((nodeId): ComputationRecord[] => {
    const node = nodes.get(nodeId)!;
    if (node.operation === "reported_metric" || evaluation.nodes.get(nodeId)?.status !== "computed") return [];
    return [{
      node_id: nodeId,
      operation: node.operation,
      operation_version: OPERATION_REGISTRY[node.operation].operation_version,
      numeric_policy_version: NUMERIC_POLICY.version,
      definition_versions: definitionVersions(plan, nodeId),
      input_refs: operationDependencies(node).map((dependency) => ({ node_id: dependency, hash: hashes.get(dependency)! })),
      output_hash: hashes.get(nodeId)!,
    }];
  });

  const results = evaluation.outputs.filter((output) => output.unit_id === unitId).map((output): ExpectedResult => {
    const closureOfOutput = dependencyClosure(plan, [output.node_id]);
    const dependencies = order.filter((nodeId) => nodeId !== output.node_id && closureOfOutput.has(nodeId));
    const published = publishedState(output.state, rejected);
    return {
      output_id: output.output_id,
      node_id: output.node_id,
      unit_id: unitId,
      dependencies,
      ...published,
      result_hash: hashCanonical("result", {
        output_id: output.output_id,
        node_id: output.node_id,
        unit_id: unitId,
        node_hash: hashes.get(output.node_id)!,
        disposition: published.disposition,
        payload: published.payload,
        dependencies,
      }),
    };
  });

  const coverage = coverageState(results.filter((result) => result.disposition === "computed").length, results.length);
  return { unit_id: unitId, rejected, coverage, computations, results };
}

/** Whether two JSON-shaped values are canonically identical. */
export function canonicallyEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function publishedState(state: NodeState, unitRejected: boolean): Pick<ExpectedResult, "disposition" | "payload"> {
  if (unitRejected || state.status === "integrity_failure") {
    return { disposition: "execution_error", payload: { kind: "gap", reason_code: "integrity_failure", explanation: REJECTED_EXPLANATION } };
  }
  if (state.status === "computed") return { disposition: "computed", payload: state.payload };
  return { disposition: state.disposition, payload: { kind: "gap", reason_code: state.reason_code, explanation: state.explanation } };
}

function stateDigest(state: NodeState): unknown {
  if (state.status === "computed") return { status: "computed", payload: state.payload };
  if (state.status === "gap") return { status: "gap", disposition: state.disposition, reason_code: state.reason_code, cause: state.cause };
  return { status: "integrity_failure", code: state.code };
}

/** Metric definition versions of the reported inputs a node depends on. */
function definitionVersions(plan: FinancialPlanV1, nodeId: LocalId): Record<string, string> {
  const closure = dependencyClosure(plan, [nodeId]);
  const versions = new Map(plan.metric_definitions.map((entry) => [entry.metric_key, entry.definition_version]));
  const used: Record<string, string> = {};
  for (const node of plan.operations) {
    if (node.operation === "reported_metric" && closure.has(node.node_id)) used[node.metric_key] = versions.get(node.metric_key)!;
  }
  return used;
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
