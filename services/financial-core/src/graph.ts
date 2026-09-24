// Operation-graph validation: acyclic identity, operand types, approved
// operation versions, parameters, and execution limits — all before any
// provider call. Limits are the lowest of the versioned defaults, the plan,
// and the parent; exceeding one is an explicit scope failure, never silent
// truncation.

import {
  DEFAULT_EXECUTION_LIMITS,
  operationDependencies,
  type ExecutionLimits,
  type FinancialPlanV1,
  type LocalId,
  type OperationNode,
  type ValidationIssue,
} from "./contracts.ts";
import { canonicalJson } from "./canonical.ts";
import { OPERATION_REGISTRY } from "./operation-registry.ts";

export function effectiveLimits(planLimits: ExecutionLimits, parent: Partial<ExecutionLimits> = {}): ExecutionLimits {
  const result = { ...DEFAULT_EXECUTION_LIMITS };
  for (const key of Object.keys(result) as Array<keyof ExecutionLimits>) {
    const parentLimit = parent[key];
    result[key] = Math.min(result[key], planLimits[key], parentLimit === undefined ? Number.POSITIVE_INFINITY : parentLimit);
  }
  return result;
}

export function validatePlanGraph(plan: FinancialPlanV1, parent: Partial<ExecutionLimits> = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });
  const nodes = nodeIndex(plan);

  plan.operations.forEach((node, index) => {
    const path = `$.operations[${index}]`;
    if (OPERATION_REGISTRY[node.operation].operation_version !== node.operation_version) {
      add(`${path}.operation_version`, "unsupported_operation_version", `${node.operation_version} is not an approved version of ${node.operation}`);
    }
    const dependencies = operationDependencies(node);
    if (new Set(dependencies).size !== dependencies.length) add(path, "invalid_parameters", "references the same operand more than once");
    for (const dependency of dependencies) {
      const target = nodes.get(dependency);
      if (target && OPERATION_REGISTRY[target.operation].produces === "predicate") {
        add(path, "invalid_operand", `uses predicate node ${dependency} as a numeric operand`);
      }
    }
  });

  if (topologicalOrderOrNull(plan) === null) add("$.operations", "dependency_cycle", "the operation graph contains a cycle");

  const limits = effectiveLimits(plan.limits, parent);
  const limit = (count: number, max: number, what: string) => {
    if (count > max) add("$.limits", "scope_limit_exceeded", `${count} ${what} exceed the limit of ${max}`);
  };
  limit(plan.subjects.members.length, limits.max_subjects, "subjects");
  limit(plan.operations.length, limits.max_operations, "operations");
  limit(plan.outputs.length, limits.max_outputs, "requested outputs");
  const periodsBySubject = new Map<LocalId, Set<string>>();
  for (const node of plan.operations) {
    if (node.operation !== "reported_metric") continue;
    const periods = periodsBySubject.get(node.subject_slot) ?? new Set<string>();
    periods.add(canonicalJson(node.period));
    periodsBySubject.set(node.subject_slot, periods);
  }
  for (const [slot, periods] of periodsBySubject) limit(periods.size, limits.max_periods_per_subject, `periods for subject ${slot}`);

  return issues;
}

/** Deterministic Kahn order: among ready nodes, the earliest declared goes first. */
export function topologicalOrder(plan: FinancialPlanV1): LocalId[] {
  const order = topologicalOrderOrNull(plan);
  if (order === null) throw new RangeError("the operation graph contains a cycle");
  return order;
}

/** The given nodes plus every transitive dependency. */
export function dependencyClosure(plan: FinancialPlanV1, nodeIds: ReadonlyArray<LocalId>): ReadonlySet<LocalId> {
  const nodes = nodeIndex(plan);
  const closure = new Set<LocalId>();
  const pending = [...nodeIds];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (closure.has(nodeId)) continue;
    closure.add(nodeId);
    const node = nodes.get(nodeId);
    if (node) pending.push(...operationDependencies(node));
  }
  return closure;
}

function topologicalOrderOrNull(plan: FinancialPlanV1): LocalId[] | null {
  const declared = new Map(plan.operations.map((node, index) => [node.node_id, index]));
  const indegree = new Map<LocalId, number>();
  const dependents = new Map<LocalId, LocalId[]>();
  for (const node of plan.operations) {
    const dependencies = [...new Set(operationDependencies(node))].filter((id) => declared.has(id));
    indegree.set(node.node_id, dependencies.length);
    for (const dependency of dependencies) dependents.set(dependency, [...(dependents.get(dependency) ?? []), node.node_id]);
  }
  const ready = plan.operations.filter((node) => indegree.get(node.node_id) === 0).map((node) => node.node_id);
  const order: LocalId[] = [];
  while (ready.length > 0) {
    ready.sort((left, right) => declared.get(left)! - declared.get(right)!);
    const next = ready.shift()!;
    order.push(next);
    for (const dependent of dependents.get(next) ?? []) {
      const remaining = indegree.get(dependent)! - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
  }
  return order.length === plan.operations.length ? order : null;
}

function nodeIndex(plan: FinancialPlanV1): Map<LocalId, OperationNode> {
  return new Map(plan.operations.map((node) => [node.node_id, node]));
}
