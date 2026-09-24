// Strict validation at every trusted financial contract boundary: JSON Schema
// (Ajv, additionalProperties: false everywhere) for shape, then semantic checks
// that a schema cannot express (identity uniqueness, declared references).
// Validated values are deep-frozen copies; callers never mutate them in place.

import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import planSchema from "../../../spec/financial_plan_schema.json" with { type: "json" };
import resultSchema from "../../../spec/financial_result_schema.json" with { type: "json" };
import { validatePlanGraph } from "./graph.ts";
import {
  operationDependencies,
  type BoundFinancialInputV1,
  type DraftFinancialResultV1,
  type FinalizedFinancialResultV1,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
  type FinancialRuntimeAuthorityV1,
  type ValidationIssue,
} from "./contracts.ts";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export class FinancialContractError extends Error {
  readonly issues: ReadonlyArray<ValidationIssue>;
  constructor(label: string, issues: ReadonlyArray<ValidationIssue>) {
    super(`${label}: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "FinancialContractError";
    this.issues = issues;
  }
}

// allErrors is off so validation cost stays bounded on oversized inputs; the
// first structural failure is enough to reject before any acquisition.
const ajv = new Ajv2020({ allErrors: false, strict: true });
ajv.addSchema(planSchema);
ajv.addSchema(resultSchema);

function compiled(schemaId: string, def: string): ValidateFunction {
  const validate = ajv.getSchema(`${schemaId}#/$defs/${def}`);
  if (!validate) throw new Error(`financial schema definition missing: ${def}`);
  return validate;
}

const validators = {
  plan: compiled(planSchema.$id, "FinancialPlanV1"),
  authority: compiled(planSchema.$id, "FinancialRuntimeAuthorityV1"),
  boundInput: compiled(resultSchema.$id, "BoundFinancialInputV1"),
  draftResult: compiled(resultSchema.$id, "DraftFinancialResultV1"),
  finalizedResult: compiled(resultSchema.$id, "FinalizedFinancialResultV1"),
};

/**
 * Validates structure, identities, references, the operation graph, and the
 * plan's own limits. Parent limits are applied again by the engine via
 * validatePlanGraph(plan, parentLimits) once server authority is known.
 */
export function validateFinancialPlan(input: unknown): ValidationResult<FinancialPlanV1> {
  const structural = structuralIssues(validators.plan, input);
  if (structural.length > 0) return { ok: false, issues: structural };
  const plan = input as FinancialPlanV1;
  const issues = planSemanticIssues(plan);
  if (issues.length > 0) return { ok: false, issues };
  const graphIssues = validatePlanGraph(plan);
  if (graphIssues.length > 0) return { ok: false, issues: graphIssues };
  return { ok: true, value: deepFreeze(structuredClone(plan)) };
}

export function validateBoundInput(input: unknown): ValidationResult<BoundFinancialInputV1> {
  const structural = structuralIssues(validators.boundInput, input);
  if (structural.length > 0) return { ok: false, issues: structural };
  return { ok: true, value: deepFreeze(structuredClone(input as BoundFinancialInputV1)) };
}

/** Engine-side draft results. A caller can never submit `verified` here. */
export function validateDraftResult(input: unknown): ValidationResult<DraftFinancialResultV1> {
  const structural = structuralIssues(validators.draftResult, input);
  if (structural.length > 0) return { ok: false, issues: structural };
  return { ok: true, value: deepFreeze(structuredClone(input as DraftFinancialResultV1)) };
}

/** Shape check for finalized records reloaded from trusted storage. */
export function validateFinalizedResult(input: unknown): ValidationResult<FinalizedFinancialResultV1> {
  const structural = structuralIssues(validators.finalizedResult, input);
  if (structural.length > 0) return { ok: false, issues: structural };
  return { ok: true, value: deepFreeze(structuredClone(input as FinalizedFinancialResultV1)) };
}

/**
 * Constructs server-owned authority. Only trusted server code calls this with
 * values from sessions, parent records, and deployment policy — never with
 * model output or plan JSON.
 */
export function createRuntimeAuthority(input: FinancialRuntimeAuthorityV1): FinancialRuntimeAuthority {
  const issues = structuralIssues(validators.authority, input);
  if (issues.length > 0) throw new FinancialContractError("financial runtime authority", issues);
  return deepFreeze(structuredClone(input)) as FinancialRuntimeAuthority;
}

function structuralIssues(validate: ValidateFunction, input: unknown): ValidationIssue[] {
  if (validate(input)) return [];
  return (validate.errors ?? []).map(issueFromAjv);
}

function issueFromAjv(error: ErrorObject): ValidationIssue {
  const path = `$${error.instancePath.replaceAll("/", ".")}`;
  if (error.keyword === "additionalProperties") {
    const property = String((error.params as { additionalProperty?: unknown }).additionalProperty);
    return { path: `${path}.${property}`, code: "unknown_field", message: "is not an allowed field" };
  }
  return { path, code: `schema_${error.keyword}`, message: error.message ?? "is invalid" };
}

function planSemanticIssues(plan: FinancialPlanV1): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });

  const slots = uniqueIds(plan.subjects.members.map((member) => member.slot_id), "$.subjects.members", "slot_id", add);
  uniqueIds(
    plan.subjects.members.map((member) => `${member.subject_ref.kind}:${member.subject_ref.id.toLowerCase()}`),
    "$.subjects.members",
    "subject_ref",
    add,
  );
  uniqueIds(plan.subjects.members.map((member) => String(member.display_order)), "$.subjects.members", "display_order", add);
  if (plan.subjects.members.filter((member) => member.role === "primary").length > 1) {
    add("$.subjects.members", "multiple_primary_subjects", "declares more than one primary subject");
  }
  if (plan.subjects.resolved_count !== plan.subjects.members.length) {
    add("$.subjects.resolved_count", "subject_count_mismatch", "must equal the number of resolved members");
  }
  if (plan.subjects.requested_count !== plan.subjects.resolved_count + plan.subjects.omitted_count) {
    add("$.subjects.requested_count", "subject_count_mismatch", "must equal resolved_count + omitted_count");
  }

  if (Number.isNaN(Date.parse(plan.time.knowledge_cutoff)) || !isCalendarValid(plan.time.knowledge_cutoff)) {
    add("$.time.knowledge_cutoff", "invalid_cutoff", "is not a valid timestamp");
  }
  if (!isKnownTimeZone(plan.time.cutoff_timezone)) {
    add("$.time.cutoff_timezone", "invalid_timezone", "is not a recognized IANA time zone");
  }

  const metrics = uniqueIds(plan.metric_definitions.map((definition) => definition.metric_key), "$.metric_definitions", "metric_key", add);
  const thresholds = uniqueIds(plan.thresholds.map((threshold) => threshold.threshold_id), "$.thresholds", "threshold_id", add);
  const nodes = uniqueIds(plan.operations.map((node) => node.node_id), "$.operations", "node_id", add);
  const units = uniqueIds(plan.publication_units.map((unit) => unit.unit_id), "$.publication_units", "unit_id", add);
  uniqueIds(plan.outputs.map((output) => output.output_id), "$.outputs", "output_id", add);

  plan.operations.forEach((node, index) => {
    const path = `$.operations[${index}]`;
    if (node.operation === "reported_metric") {
      if (!slots.has(node.subject_slot)) add(`${path}.subject_slot`, "undeclared_subject", `references undeclared subject slot ${node.subject_slot}`);
      if (!metrics.has(node.metric_key)) add(`${path}.metric_key`, "undeclared_metric", `references undeclared metric ${node.metric_key}`);
    }
    if (node.operation === "threshold" && !thresholds.has(node.threshold_id)) {
      add(`${path}.threshold_id`, "unknown_threshold", `references undeclared threshold ${node.threshold_id}`);
    }
    for (const dependency of operationDependencies(node)) {
      if (!nodes.has(dependency)) add(path, "unknown_node", `depends on undeclared node ${dependency}`);
    }
  });

  const unitsWithOutputs = new Set<string>();
  plan.outputs.forEach((output, index) => {
    if (!nodes.has(output.node_id)) add(`$.outputs[${index}].node_id`, "unknown_node", `references undeclared node ${output.node_id}`);
    if (!units.has(output.unit_id)) add(`$.outputs[${index}].unit_id`, "unknown_publication_unit", `references undeclared unit ${output.unit_id}`);
    unitsWithOutputs.add(output.unit_id);
  });
  plan.publication_units.forEach((unit, index) => {
    if (!unitsWithOutputs.has(unit.unit_id)) add(`$.publication_units[${index}]`, "empty_publication_unit", "declares no requested outputs");
  });

  return issues;
}

function uniqueIds(
  ids: ReadonlyArray<string>,
  path: string,
  field: string,
  add: (path: string, code: string, message: string) => void,
): Set<string> {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) add(path, `duplicate_${field}`, `declares ${field} ${id} more than once`);
    seen.add(id);
  }
  return seen;
}

function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Date.parse rolls over impossible dates such as 2024-02-30; reject them.
function isCalendarValid(timestamp: string): boolean {
  const [year, month, day] = timestamp.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
