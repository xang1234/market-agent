// Translates a complete request into a bounded, validated FinancialPlanV1.
//
// Authority stays with the server: the subject set comes from server-side
// resolution; definition versions from the approved catalog; cutoff, basis,
// freshness, limits, units, attribution, and plan identity from the host.
// A model may only propose a restricted draft (subject mentions -> slots,
// operations, outputs, thresholds). Anything else — ownership, budgets, modes,
// verification, SQL, expressions — fails validation. One schema repair is
// allowed within the parent's model budget. Deterministic callers (grids,
// saved conditions, Discovery criteria) plan without any model call.
// Nothing here acquires evidence.

import {
  DEFAULT_EXECUTION_LIMITS,
  hashCanonical,
  METRIC_CATALOG_V1,
  OPERATION_REGISTRY,
  validateFinancialPlan,
  type ExecutionLimits,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
  type FinancialSubjectRef,
  type PlanOrigin,
  type PublicationUnitKind,
  type ReportingBasis,
  type ValidationIssue,
} from "../../financial-core/src/index.ts";
import { authorizePlan } from "./plan-authority.ts";
import { interpretPlan } from "./plan-interpretation.ts";

export const PLANNER_ADAPTER_VERSION = "financial-planner.v1";
export const PLANNER_PROMPT_VERSION = "financial-plan-prompt.v1";
export const DETERMINISTIC_ADAPTER_VERSION = "financial-deterministic-planner.v1";

/** Adapter over the existing model router (router.complete). */
export type PlanningModel = (request: { messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }> }) => Promise<{ text: string; model: string }>;

/** Structural view of services/llm's ControlledRouter; the engine does not import the router package. */
export type PlanningRouter = {
  complete(request: {
    messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string; deployment: { model: string } }>;
};

export function planningModelFromRouter(router: PlanningRouter): PlanningModel {
  return async (request) => {
    const result = await router.complete({ messages: request.messages, temperature: 0, maxTokens: 4096 });
    return { text: result.text, model: result.deployment.model };
  };
}

export type RequestedSubject = Readonly<{
  mention: string;
  resolution:
    | Readonly<{ status: "resolved"; subject_ref: FinancialSubjectRef; label: string }>
    | Readonly<{ status: "ambiguous"; options: ReadonlyArray<Readonly<{ subject_ref: FinancialSubjectRef; label: string }>> }>
    | Readonly<{ status: "not_found" }>;
}>;

/** Everything the server decides. None of it can come from model output. */
export type PlanningContext = Readonly<{
  plan_id: string;
  origin: PlanOrigin;
  knowledge_cutoff: string;
  cutoff_timezone: string;
  reporting_basis: ReportingBasis;
  freshness_max_age_days: number | null;
  authority: FinancialRuntimeAuthority;
  parent_limits: Partial<ExecutionLimits>;
  max_model_calls: number;
  requested_subjects: ReadonlyArray<RequestedSubject>;
  publication_unit_kind: PublicationUnitKind;
}>;

export type ClarificationChoice = Readonly<{ choice_id: string; label: string; subject_ref?: FinancialSubjectRef }>;
export type Clarification = Readonly<{
  clarification_id: string;
  kind: "subject" | "metric" | "request";
  question: string;
  choices: ReadonlyArray<ClarificationChoice>;
}>;

export type PlanningResult =
  | { outcome: "ready"; plan: FinancialPlanV1; model_calls: number }
  | { outcome: "needs_clarification"; clarification: Clarification; model_calls: number }
  | { outcome: "configuration_needed"; reason: string; model_calls: 0 }
  | { outcome: "unsupported"; reason: string; issues: ValidationIssue[]; model_calls: number };

export class ClarificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClarificationError";
  }
}

/** Accepts an answer only for the exact clarification it was offered for. */
export function resolveClarification(clarification: Clarification, answer: { clarification_id: string; choice_id: string }): ClarificationChoice {
  if (answer.clarification_id !== clarification.clarification_id) throw new ClarificationError("answer does not match this clarification");
  const choice = clarification.choices.find((candidate) => candidate.choice_id === answer.choice_id);
  if (!choice) throw new ClarificationError("choice is not one of the offered options");
  return choice;
}

export async function planFinancialRequest(context: PlanningContext, requestText: string, model: PlanningModel): Promise<PlanningResult> {
  const subjectQuestion = unresolvedSubjectClarification(context);
  if (subjectQuestion) return { outcome: "needs_clarification", clarification: subjectQuestion, model_calls: 0 };

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt() },
    { role: "user", content: userPrompt(context, requestText) },
  ];
  let calls = 0;
  let lastIssues: ValidationIssue[] = [{ path: "$", code: "no_model_budget", message: "no model calls are available for planning" }];
  const maxCalls = Math.min(2, Math.max(0, context.max_model_calls));
  while (calls < maxCalls) {
    const response = await model({ messages });
    calls += 1;
    const draft = parseDraft(response.text);
    const attempt = draft.ok ? assemblePlan(context, draft.value, { kind: "model", adapter_version: PLANNER_ADAPTER_VERSION, model: response.model, prompt_version: PLANNER_PROMPT_VERSION }) : draft;
    if (attempt.ok) return finish(attempt.value, calls);
    if (attempt.clarification) return { outcome: "needs_clarification", clarification: attempt.clarification, model_calls: calls };
    if (attempt.unsupported) return { outcome: "unsupported", reason: attempt.unsupported, issues: attempt.issues, model_calls: calls };
    lastIssues = attempt.issues;
    messages.push({ role: "assistant", content: response.text }, { role: "user", content: repairPrompt(attempt.issues) });
  }
  const missing = lastIssues.filter((issue) => issue.code === "subject_not_planned");
  if (missing.length > 0) {
    return {
      outcome: "needs_clarification",
      clarification: clarification("request", `The request could not be planned for ${missing.map((issue) => issue.message).join(", ")}. Please restate what to calculate for each company.`, []),
      model_calls: calls,
    };
  }
  return { outcome: "unsupported", reason: lastIssues.map((issue) => issue.code).join(", "), issues: lastIssues, model_calls: calls };
}

/** Plans an already-structured draft (grid column, saved condition, approved criterion) with zero model calls. */
export function buildDeterministicPlan(context: PlanningContext, draft: unknown): PlanningResult {
  if (unresolvedSubjectClarification(context)) {
    return { outcome: "configuration_needed", reason: "a configured subject does not resolve to one canonical identity", model_calls: 0 };
  }
  const parsed = checkDraft(draft);
  const attempt = parsed.ok ? assemblePlan(context, parsed.value, { kind: "deterministic", adapter_version: DETERMINISTIC_ADAPTER_VERSION, model: null, prompt_version: null }) : parsed;
  if (attempt.ok) return finish(attempt.value, 0);
  if (attempt.clarification) return { outcome: "configuration_needed", reason: attempt.clarification.question, model_calls: 0 };
  return { outcome: "unsupported", reason: attempt.unsupported ?? attempt.issues.map((issue) => issue.code).join(", "), issues: attempt.issues, model_calls: 0 };
}

// ---------------------------------------------------------------------------

type Draft = {
  subjects: Array<{ slot_id: string; mention: string }>;
  operations: Array<Record<string, unknown>>;
  outputs: Array<{ output_id: string; node_id: string }>;
  thresholds: Array<Record<string, unknown>>;
};

type Attempt<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[]; clarification?: Clarification; unsupported?: string };

const READY_KEYS = ["outcome", "subjects", "operations", "outputs", "thresholds"];

function parseDraft(text: string): Attempt<Draft> {
  const body = text.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return invalid("$", "invalid_json", "the response was not a JSON object");
  }
  if (isRecord(value) && value.outcome === "unsupported") {
    return { ok: false, issues: [], unsupported: typeof value.reason === "string" ? value.reason.slice(0, 200) : "the model reported the request as unsupported" };
  }
  if (isRecord(value) && value.outcome === "needs_clarification") {
    const question = typeof value.question === "string" ? value.question.slice(0, 500) : "Please clarify the request.";
    const choices = Array.isArray(value.choices) ? value.choices.filter((choice): choice is string => typeof choice === "string").slice(0, 10) : [];
    return { ok: false, issues: [], clarification: clarification("request", question, choices.map((label, index) => ({ choice_id: `option_${index + 1}`, label }))) };
  }
  return checkDraft(value);
}

function checkDraft(value: unknown): Attempt<Draft> {
  if (!isRecord(value)) return invalid("$", "invalid_draft", "the draft must be an object");
  const unknownKeys = Object.keys(value).filter((key) => !READY_KEYS.includes(key));
  if (unknownKeys.length > 0) return invalid("$", "unknown_field", `fields not allowed in a plan draft: ${unknownKeys.join(", ")}`);
  if (value.outcome !== undefined && value.outcome !== "ready") return invalid("$.outcome", "invalid_outcome", "outcome must be ready, needs_clarification, or unsupported");
  for (const key of ["subjects", "operations", "outputs"] as const) {
    if (!Array.isArray(value[key])) return invalid(`$.${key}`, "invalid_draft", `${key} must be an array`);
  }
  if (value.thresholds !== undefined && !Array.isArray(value.thresholds)) return invalid("$.thresholds", "invalid_draft", "thresholds must be an array");
  for (const subject of value.subjects as unknown[]) {
    if (!isRecord(subject) || typeof subject.slot_id !== "string" || typeof subject.mention !== "string" || Object.keys(subject).length !== 2) {
      return invalid("$.subjects", "invalid_draft", "each subject is {slot_id, mention}");
    }
  }
  for (const output of value.outputs as unknown[]) {
    if (!isRecord(output) || typeof output.output_id !== "string" || typeof output.node_id !== "string" || Object.keys(output).length !== 2) {
      return invalid("$.outputs", "invalid_draft", "each output is {output_id, node_id}");
    }
  }
  if ((value.operations as unknown[]).some((operation) => !isRecord(operation)) || ((value.thresholds ?? []) as unknown[]).some((threshold) => !isRecord(threshold))) {
    return invalid("$.operations", "invalid_draft", "operations and thresholds must be objects");
  }
  return {
    ok: true,
    value: {
      subjects: value.subjects as Draft["subjects"],
      operations: value.operations as Draft["operations"],
      outputs: value.outputs as Draft["outputs"],
      thresholds: (value.thresholds ?? []) as Draft["thresholds"],
    },
  };
}

function assemblePlan(context: PlanningContext, draft: Draft, planner: FinancialPlanV1["planner"]): Attempt<FinancialPlanV1> {
  const resolved = context.requested_subjects.flatMap((subject) =>
    subject.resolution.status === "resolved" ? [{ mention: subject.mention, ref: subject.resolution.subject_ref, label: subject.resolution.label }] : [],
  );
  const issues: ValidationIssue[] = [];
  const slotByMention = new Map<string, string>();
  for (const subject of draft.subjects) {
    if (!resolved.some((entry) => entry.mention === subject.mention)) {
      issues.push({ path: "$.subjects", code: "undeclared_subject", message: `${subject.mention} is not one of the requested subjects` });
    } else if (slotByMention.has(subject.mention)) {
      issues.push({ path: "$.subjects", code: "duplicate_subject", message: `${subject.mention} appears more than once` });
    } else {
      slotByMention.set(subject.mention, subject.slot_id);
    }
  }

  const metricKeys = [...new Set(draft.operations.flatMap((operation) => (operation.operation === "reported_metric" && typeof operation.metric_key === "string" ? [operation.metric_key] : [])))];
  const unknownMetric = metricKeys.find((key) => !METRIC_CATALOG_V1.has(key));
  if (unknownMetric) {
    const question = `The metric "${unknownMetric}" has no approved definition. Which approved metric should be used instead?`;
    return {
      ok: false,
      issues: [],
      clarification: clarification(
        "metric",
        question,
        [...METRIC_CATALOG_V1.values()].map((definition) => ({ choice_id: definition.metric_key, label: `${definition.label} (${definition.definition_version})` })),
      ),
    };
  }

  const members = resolved.flatMap((entry, index) => {
    const slot = slotByMention.get(entry.mention);
    return slot ? [{ slot_id: slot, subject_ref: entry.ref, display_order: index, role: index === 0 ? ("primary" as const) : ("peer" as const) }] : [];
  });
  for (const entry of resolved) {
    const slot = slotByMention.get(entry.mention);
    const planned = slot !== undefined && draft.operations.some((operation) => operation.operation === "reported_metric" && operation.subject_slot === slot);
    if (!planned) issues.push({ path: "$.operations", code: "subject_not_planned", message: entry.mention });
  }
  if (issues.length > 0) return { ok: false, issues };

  const unitId = "answer";
  const plan = {
    schema_version: "financial_plan.v1",
    plan_id: context.plan_id,
    origin: context.origin,
    planner,
    catalog_version: "catalog.v1",
    interpretation: null,
    subjects: {
      membership: "explicit",
      requested_count: context.requested_subjects.length,
      resolved_count: members.length,
      omitted_count: context.requested_subjects.length - members.length,
      members,
    },
    time: { knowledge_cutoff: context.knowledge_cutoff, cutoff_timezone: context.cutoff_timezone, time_mode: "public_information" },
    policies: {
      reporting_basis: context.reporting_basis,
      period_policy: "exact_fiscal",
      freshness: { max_age_days: context.freshness_max_age_days },
      source_policy_version: "sources.v1",
    },
    metric_definitions: metricKeys.map((key) => ({ metric_key: key, definition_version: METRIC_CATALOG_V1.get(key)!.definition_version })),
    operations: draft.operations.map((operation) => {
      const kind = operation.operation;
      const version = typeof kind === "string" && kind in OPERATION_REGISTRY ? OPERATION_REGISTRY[kind as keyof typeof OPERATION_REGISTRY].operation_version : "unknown";
      return { ...operation, operation_version: version };
    }),
    outputs: draft.outputs.map((output) => ({ output_id: output.output_id, node_id: output.node_id, unit_id: unitId })),
    publication_units: [{ unit_id: unitId, kind: context.publication_unit_kind }],
    thresholds: draft.thresholds.map((threshold) => ({ ...threshold, attribution: { kind: "user_request", ref: context.origin.ref } })),
    limits: { ...DEFAULT_EXECUTION_LIMITS },
    presentation_template_version: "financial-answer.v1",
  };
  const validated = validateFinancialPlan(plan);
  if (!validated.ok) return { ok: false, issues: validated.issues };
  const authorized = authorizePlan(validated.value, context.authority, context.parent_limits);
  if (!authorized.ok) {
    return { ok: false, issues: authorized.issues, unsupported: authorized.issues.map((issue) => issue.code).join(", ") };
  }
  const labels = new Map(members.map((member) => [member.slot_id, resolved.find((entry) => entry.ref.id === member.subject_ref.id)!.label]));
  const withInterpretation = validateFinancialPlan({ ...plan, interpretation: interpretPlan(validated.value, labels) });
  return withInterpretation.ok ? withInterpretation : { ok: false, issues: withInterpretation.issues };
}

function finish(plan: FinancialPlanV1, calls: number): PlanningResult {
  return { outcome: "ready", plan, model_calls: calls };
}

function unresolvedSubjectClarification(context: PlanningContext): Clarification | null {
  for (const subject of context.requested_subjects) {
    if (subject.resolution.status === "ambiguous") {
      return clarification(
        "subject",
        `Which company did you mean by "${subject.mention}"?`,
        subject.resolution.options.map((option) => ({ choice_id: `${option.subject_ref.kind}:${option.subject_ref.id}`, label: option.label, subject_ref: option.subject_ref })),
      );
    }
    if (subject.resolution.status === "not_found") {
      return clarification("subject", `"${subject.mention}" did not match a known company. Which company did you mean?`, []);
    }
  }
  return null;
}

function clarification(kind: Clarification["kind"], question: string, choices: ReadonlyArray<ClarificationChoice>): Clarification {
  return { clarification_id: hashCanonical("clarification", { kind, question, choices: choices.map((choice) => choice.choice_id) }), kind, question, choices };
}

function invalid(path: string, code: string, message: string): Attempt<never> {
  return { ok: false, issues: [{ path, code, message }] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function systemPrompt(): string {
  const metrics = [...METRIC_CATALOG_V1.keys()].join(", ");
  const operations = Object.keys(OPERATION_REGISTRY).join(", ");
  return [
    "You translate a financial research request into a JSON plan draft. Reply with one JSON object only.",
    `Approved metric keys: ${metrics}. Approved operations: ${operations}.`,
    'Ready drafts: {"outcome":"ready","subjects":[{"slot_id","mention"}],"operations":[...],"outputs":[{"output_id","node_id"}],"thresholds":[{"threshold_id","value","unit"}]}.',
    'Operations: reported_metric {node_id, operation, subject_slot, metric_key, period:{kind:"fiscal_period",fiscal_year,fiscal_period} or {kind:"latest",period_type,offset}}; absolute_change/percent_change_positive_base {current, prior}; gross_margin/operating_margin/net_margin {numerator, revenue}; ratio {ratio_key, numerator, denominator}; trailing_sum {quarters:[4 node ids]}; threshold {subject, threshold_id, comparison}; peer_compare {members, direction}.',
    "Plan every requested company. Threshold values are decimal strings. Never invent metric definitions, identifiers, owners, budgets, modes, or verification fields.",
    'If a definition is ambiguous reply {"outcome":"needs_clarification","question","choices"}; if it cannot be expressed reply {"outcome":"unsupported","reason"}.',
  ].join("\n");
}

function userPrompt(context: PlanningContext, requestText: string): string {
  const subjects = context.requested_subjects.map((subject) => subject.mention).join("; ");
  return `Request: ${requestText}\nRequested companies (mentions): ${subjects}`;
}

function repairPrompt(issues: ReadonlyArray<ValidationIssue>): string {
  return `The draft was rejected. Fix these issues and reply with the corrected JSON only:\n${issues.slice(0, 20).map((issue) => `- ${issue.code} at ${issue.path}: ${issue.message}`).join("\n")}`;
}
