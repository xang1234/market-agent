// Saved numerical rules: a thesis condition, an approved Discovery criterion —
// any user-saved "metric, period, comparison, exact threshold, maximum age".
//
// A saved rule is immutable. It becomes one deterministic plan (a reported
// value and a threshold predicate attributed to the saved rule), evaluated at
// a pinned cutoff with the saved maximum age as freshness. Nothing
// reinterprets it and no model is involved. A verified predicate is met or not
// met by the saved comparison; any gap — no eligible value, a value older than
// the saved maximum age, an unsupported definition — is unresolved. Parents
// supply their authority, request key, attribution, and publication guard.

import { randomUUID } from "node:crypto";

import {
  METRIC_CATALOG_V1,
  type Comparison,
  type DecimalInput,
  type FinancialRuntimeAuthority,
  type FinancialUnit,
  type PlanOrigin,
  type PublicationUnitKind,
  type ReportingBasis,
  type ThresholdAttribution,
} from "../../financial-core/src/index.ts";
import type { PersistParentArtifact } from "./finalize.ts";
import { buildDeterministicPlan } from "./planner.ts";
import type { FinancialEvidencePort, FinancialPool, SqlExecutor } from "./ports.ts";
import { issuerLabels, publishRequest } from "./request.ts";

/** The saved shape; thesis conditions and Discovery criteria store exactly this. */
export type SavedMetricRule = Readonly<{
  metric_key: string;
  unit: string;
  period_kind: "point" | "fiscal_q" | "fiscal_y" | "ttm";
  operator: Comparison;
  threshold: DecimalInput;
  max_age_days: number;
}>;

/** The certified calculation behind a rule's outcome. */
export type CertifiedUnitRef = Readonly<{
  run_id: string;
  unit_id: string;
  snapshot_id: string | null;
  certificate_digest: string | null;
  /** Deterministic over definition, inputs, and outcome; identical evidence yields the same hash on every run. */
  result_hash: string | null;
}>;

export type SavedRuleOutcome = Readonly<{
  status: "met" | "not_met" | "unresolved";
  reason_code: string | null;
  reason: string;
  fact_refs: string[];
  certified: CertifiedUnitRef | null;
}>;

export type SavedRuleDeps = Readonly<{
  pool: FinancialPool;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
}>;

/** One saved rule for one subject at one cutoff, under the parent's own authority and publication guard. */
export type SavedRuleRequest = Readonly<{
  authority: FinancialRuntimeAuthority;
  request_key: string;
  subject: Readonly<{ kind: "issuer"; id: string }>;
  rule: SavedMetricRule;
  as_of: string;
  /**
   * Saved monitoring rules read the latest disclosure public by the cutoff
   * (`as_restated`), as their stored-fact checks always did with active facts.
   */
  reporting_basis: ReportingBasis;
  origin: PlanOrigin;
  threshold_attribution: ThresholdAttribution;
  publication_unit_kind: PublicationUnitKind;
  /** Runs in the finalization transaction; throwing keeps the unit unsealed. */
  persistParent: PersistParentArtifact;
}>;

const UNIT_ID = "rule";
const SUBJECT_MENTION = "saved subject";

type Draft = ReturnType<typeof ruleDraft>;
type Translation = Readonly<{ ok: true; draft: Draft }> | Readonly<{ ok: false; reason: string }>;

/**
 * Translates a saved rule into a plan draft, exactly as saved. The threshold's
 * currency comes from the subject's own facts for the metric; anything the
 * verified definitions cannot express is unsupported.
 */
export async function translateSavedRule(db: SqlExecutor, subjectId: string, rule: SavedMetricRule): Promise<Translation> {
  const definition = METRIC_CATALOG_V1.get(rule.metric_key);
  if (!definition) return { ok: false, reason: "metric_has_no_verified_definition" };
  if (rule.period_kind === "point") return { ok: false, reason: "point_in_time_metric_not_certified" };
  if (rule.period_kind === "ttm" && definition.value_kind !== "flow") return { ok: false, reason: "trailing_sum_needs_a_flow_metric" };
  const unit = await thresholdUnit(db, subjectId, rule, definition.unit_kind);
  if (unit === null) return { ok: false, reason: "unit_does_not_match_definition" };
  return { ok: true, draft: ruleDraft(rule, unit) };
}

/**
 * Plans the rule exactly as saved, computes and seals it under the parent's
 * authority, and reads the outcome back from committed records. A retry with
 * the same request key resumes; it never recomputes.
 */
export async function evaluateSavedRule(deps: SavedRuleDeps, request: SavedRuleRequest): Promise<SavedRuleOutcome> {
  // Deterministic: a rule that translated once translates the same way again, with or without an earlier run.
  const translation = await translateSavedRule(deps.pool, request.subject.id, request.rule);
  if (!translation.ok) return unresolved(translation.reason);
  const outcome = await publishRequest(deps.pool, {
    authority: request.authority,
    request_key: request.request_key,
    mode: "enforce",
    plan: async (db) => buildDeterministicPlan(
      {
        plan_id: randomUUID(),
        origin: request.origin,
        knowledge_cutoff: new Date(request.as_of).toISOString(),
        cutoff_timezone: "UTC",
        reporting_basis: request.reporting_basis,
        freshness_max_age_days: request.rule.max_age_days,
        authority: request.authority,
        parent_limits: {},
        max_model_calls: 0,
        requested_subjects: [{
          mention: SUBJECT_MENTION,
          resolution: { status: "resolved", subject_ref: request.subject, label: (await issuerLabels(db, [request.subject.id])).get(request.subject.id) ?? request.subject.id },
        }],
        publication_unit_kind: request.publication_unit_kind,
        threshold_attribution: request.threshold_attribution,
      },
      translation.draft,
      [{ unit_id: UNIT_ID, output_ids: ["value", "predicate"] }],
    ),
    evidence: deps.evidence,
    persistParent: request.persistParent,
  });
  switch (outcome.status) {
    case "driven":
      return committedOutcome(deps.pool, outcome.run_id);
    case "gap":
      return unresolved(outcome.reason);
    case "clarification":
    case "planned":
      // A deterministic enforce-mode plan never asks or stops at planning.
      return unresolved("configuration_needed");
  }
}

// ---------------------------------------------------------------------------

function ruleDraft(rule: SavedMetricRule, unit: FinancialUnit) {
  const reported = (nodeId: string, periodType: "annual" | "quarterly", offset: number) => ({
    node_id: nodeId,
    operation: "reported_metric",
    subject_slot: "subject",
    metric_key: rule.metric_key,
    period: { kind: "latest", period_type: periodType, offset },
  });
  const quarters = [0, 1, 2, 3].map((offset) => reported(`quarter_${offset}`, "quarterly", offset));
  const value = rule.period_kind === "ttm"
    ? [...quarters, { node_id: "value", operation: "trailing_sum", quarters: quarters.map((node) => node.node_id) }]
    : [reported("value", rule.period_kind === "fiscal_y" ? "annual" : "quarterly", 0)];
  return {
    subjects: [{ slot_id: "subject", mention: SUBJECT_MENTION }],
    operations: [...value, { node_id: "predicate", operation: "threshold", subject: "value", threshold_id: "saved", comparison: rule.operator }],
    outputs: [{ output_id: "value", node_id: "value" }, { output_id: "predicate", node_id: "predicate" }],
    // The saved threshold, verbatim as exact decimal text.
    thresholds: [{ threshold_id: "saved", value: String(rule.threshold), unit }],
  };
}

async function thresholdUnit(db: SqlExecutor, subjectId: string, rule: SavedMetricRule, unitKind: FinancialUnit["kind"]): Promise<FinancialUnit | null> {
  if (unitKind !== "currency" && unitKind !== "currency_per_share") return rule.unit === unitKind ? { kind: unitKind } : null;
  // An ISO code saved as the unit names the currency; a generic currency unit takes the subject's own reporting currency.
  if (/^[A-Z]{3}$/u.test(rule.unit)) return { kind: unitKind, currency: rule.unit };
  if (rule.unit !== unitKind) return null;
  const currencies = (await db.query<{ currency: string }>(
    `select distinct f.currency from facts f join metrics m on m.metric_id = f.metric_id
      where f.subject_kind = 'issuer' and f.subject_id = $1::uuid and m.metric_key = $2 and f.currency is not null`,
    [subjectId, rule.metric_key],
  )).rows;
  return currencies.length === 1 ? { kind: unitKind, currency: currencies[0]!.currency } : null;
}

/** Reads the committed unit: the predicate's outcome, its result hash, the certificate, and the bound facts. */
async function committedOutcome(db: SqlExecutor, runId: string): Promise<SavedRuleOutcome> {
  const unit = (await db.query<{ state: string; snapshot_id: string | null; certificate_digest: string | null }>(
    `select state, snapshot_id::text, certificate_digest from financial_run_units where run_id = $1 and unit_id = $2`,
    [runId, UNIT_ID],
  )).rows[0];
  if (unit?.state !== "sealed") return unresolved("verification_failed");
  const outputs = new Map((await db.query<{ output_id: string; disposition: string; payload: { kind: string; outcome?: boolean; reason_code?: string }; result_hash: string }>(
    `select output_id, disposition, payload, result_hash from financial_results where run_id = $1 and state = 'finalized'`,
    [runId],
  )).rows.map((row) => [row.output_id, row]));
  const predicate = outputs.get("predicate");
  const value = outputs.get("value");
  const facts = (await db.query<{ fact_id: string }>(
    `select distinct fact_id::text from financial_run_inputs where run_id = $1 and binding_status = 'bound' order by fact_id`,
    [runId],
  )).rows.map((row) => row.fact_id);
  const certified = { run_id: runId, unit_id: UNIT_ID, snapshot_id: unit.snapshot_id, certificate_digest: unit.certificate_digest, result_hash: predicate?.result_hash ?? null };
  if (predicate?.disposition !== "verified" || predicate.payload.kind !== "predicate") {
    // A predicate without a value is blocked; the value's own gap says why (e.g. older than the saved maximum age).
    const reasonCode = (value?.disposition !== "verified" ? value?.payload.reason_code : predicate?.payload.reason_code) ?? "no_result";
    return { ...unresolved(reasonCode), fact_refs: facts, certified };
  }
  const met = predicate.payload.outcome === true;
  return {
    status: met ? "met" : "not_met",
    reason_code: null,
    reason: met
      ? "The verified calculation at the assessment cutoff meets the saved threshold."
      : "The verified calculation at the assessment cutoff does not meet the saved threshold.",
    fact_refs: facts,
    certified,
  };
}

const UNRESOLVED_REASONS: Readonly<Record<string, string>> = {
  stale_input: "The latest eligible value is older than the saved maximum age at the assessment cutoff.",
  missing_input: "No eligible value was public at the assessment cutoff.",
  blocked_by_dependency: "No eligible value was public at the assessment cutoff.",
};

function unresolved(reasonCode: string): SavedRuleOutcome {
  return {
    status: "unresolved",
    reason_code: reasonCode,
    reason: UNRESOLVED_REASONS[reasonCode] ?? `The saved rule could not be verified (${reasonCode}).`,
    fact_refs: [],
    certified: null,
  };
}
