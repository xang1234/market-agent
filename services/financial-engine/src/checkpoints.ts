// Per-unit durable checkpoints. The evaluation of a pinned graph over its
// persisted bindings is deterministic, so each node gets a lineage hash and
// each publication unit's computations and requested-output results are
// written in one fenced transaction. A resumed worker re-derives the same
// hashes, skips units already checkpointed, and any divergence from what was
// persisted is an integrity failure rather than an overwrite.

import { randomUUID } from "node:crypto";
import {
  dependencyClosure,
  hashCanonical,
  NUMERIC_POLICY,
  OPERATION_REGISTRY,
  operationDependencies,
  topologicalOrder,
  unitClosures,
  validateDraftResult,
  type DraftFinancialResultV1,
  type FinancialPlanV1,
  type GraphEvaluation,
  type LocalId,
  type NodeState,
  type Sha256Hex,
} from "../../financial-core/src/index.ts";
import type { InputBinding } from "./bind-inputs.ts";
import { assertLeaseFence, type RunLease } from "./lease.ts";
import type { SqlExecutor } from "./ports.ts";
import { ExecutionIntegrityError, persistComputation, persistResult, type DraftComputation } from "./result-repo.ts";
import { markUnitComputed, rejectUnit } from "./unit-repo.ts";

export type UnitCheckpoint = Readonly<{
  unit_id: LocalId;
  rejected: boolean;
  coverage: "complete" | "partial" | "none";
  computations: ReadonlyArray<DraftComputation>;
  results: ReadonlyArray<Readonly<{ result: DraftFinancialResultV1; result_hash: Sha256Hex }>>;
}>;

const REJECTED_EXPLANATION = "An input to this section failed integrity checks, so the section was withheld.";

/**
 * Lineage hash of every evaluated node, in topological order. A bound
 * reported input is identified by its bound payload hash; every other node by
 * its operation, its inputs' hashes, and its outcome.
 */
export function nodeHashes(
  plan: FinancialPlanV1,
  evaluation: GraphEvaluation,
  bindings: ReadonlyMap<LocalId, InputBinding>,
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

/** Everything a unit publishes, derived purely from the evaluation. */
export function buildUnitCheckpoint(
  plan: FinancialPlanV1,
  evaluation: GraphEvaluation,
  hashes: ReadonlyMap<LocalId, Sha256Hex>,
  unitId: LocalId,
  newResultId: () => string = randomUUID,
): UnitCheckpoint {
  const closure = unitClosures(plan).get(unitId);
  const unit = evaluation.units.find((entry) => entry.unit_id === unitId);
  if (!closure || !unit) throw new ExecutionIntegrityError(`unit ${unitId} is not declared by the plan`);
  const rejected = unit.state === "rejected";
  const nodes = new Map(plan.operations.map((node) => [node.node_id, node]));
  const order = topologicalOrder(plan);

  const computations = rejected ? [] : closure.node_ids.flatMap((nodeId): DraftComputation[] => {
    const node = nodes.get(nodeId)!;
    const state = evaluation.nodes.get(nodeId);
    if (node.operation === "reported_metric" || state?.status !== "computed") return [];
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

  const outputs = evaluation.outputs.filter((output) => output.unit_id === unitId);
  const results = outputs.map((output) => {
    const closureOfOutput = dependencyClosure(plan, [output.node_id]);
    const dependencies = order.filter((nodeId) => nodeId !== output.node_id && closureOfOutput.has(nodeId));
    const published = publishedState(output.state, rejected);
    const draft = {
      schema_version: "financial_result.v1",
      result_id: newResultId(),
      output_id: output.output_id,
      node_id: output.node_id,
      unit_id: unitId,
      dependencies,
      state: "draft",
      ...published,
    };
    const validated = validateDraftResult(draft);
    if (!validated.ok) {
      throw new ExecutionIntegrityError(`draft result ${output.output_id} is invalid: ${validated.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    }
    const resultHash = hashCanonical("result", {
      output_id: output.output_id,
      node_id: output.node_id,
      unit_id: unitId,
      node_hash: hashes.get(output.node_id)!,
      disposition: published.disposition,
      payload: published.payload,
      dependencies,
    });
    return { result: validated.value, result_hash: resultHash };
  });

  const computed = results.filter(({ result }) => result.disposition === "computed").length;
  const coverage = computed === results.length ? "complete" : computed === 0 ? "none" : "partial";
  return { unit_id: unitId, rejected, coverage, computations, results };
}

/**
 * Writes one unit's computations, results, and state in a single fenced
 * transaction. Returns false when the unit was already checkpointed.
 */
export async function checkpointUnit(client: SqlExecutor, lease: RunLease, checkpoint: UnitCheckpoint): Promise<boolean> {
  await client.query("begin");
  try {
    await assertLeaseFence(client, lease);
    const state = (await client.query<{ state: string }>(
      `select state from financial_run_units where run_id = $1 and unit_id = $2`,
      [lease.run_id, checkpoint.unit_id],
    )).rows[0]?.state;
    if (state === undefined) throw new ExecutionIntegrityError(`unit ${checkpoint.unit_id} was not declared`);
    if (state !== "pending") {
      await client.query("commit");
      return false;
    }
    const computationIds = new Map<LocalId, string>();
    for (const computation of checkpoint.computations) {
      computationIds.set(computation.node_id, await persistComputation(client, lease.run_id, computation));
    }
    for (const { result, result_hash } of checkpoint.results) {
      await persistResult(client, lease.run_id, result, result_hash, computationIds.get(result.node_id) ?? null);
    }
    if (checkpoint.rejected) await rejectUnit(client, lease, checkpoint.unit_id, "integrity_failure");
    else await markUnitComputed(client, lease, checkpoint.unit_id, checkpoint.coverage);
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function publishedState(
  state: NodeState,
  unitRejected: boolean,
): Pick<DraftFinancialResultV1, "disposition" | "payload"> {
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
