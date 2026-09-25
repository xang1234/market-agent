// Numerical thesis conditions through the verified financial engine.
//
// A saved condition is immutable: its metric, unit, period, operator, exact
// threshold, and maximum age become one deterministic plan (a reported value
// and a threshold predicate attributed to the saved condition), evaluated at
// the run's pinned cutoff. Nothing reinterprets the condition and no model is
// involved. A verified predicate maps to supported/challenged by the saved
// comparison; any gap — no eligible value, a value older than the saved
// maximum age at the cutoff, an unsupported definition — is unresolved.
//
// Each condition is sealed under its own certificate, and only while the
// thesis version it was computed for is still the agent's current one.

import { randomUUID } from "node:crypto";

import {
  createRuntimeAuthority,
  METRIC_CATALOG_V1,
  type FinancialRuntimeAuthority,
  type FinancialUnit,
  type PlanOrigin,
  type PublicationUnitKind,
  type ReportingBasis,
  type ThresholdAttribution,
} from "../../financial-core/src/index.ts";
import type { PersistParentArtifact } from "../../financial-engine/src/finalize.ts";
import type { FinancialPool } from "../../financial-engine/src/http.ts";
import { buildDeterministicPlan, type PlanningContext } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { reserveAndPublish, type PublishResult } from "../../financial-engine/src/publish.ts";
import { findRunForRequest } from "../../financial-engine/src/run-repo.ts";
import { snapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import type { ConditionAssessment, ConditionFinancialRef, ThesisCondition, ThesisMetricCheck, ThesisVersion } from "./thesis-types.ts";

export type ThesisFinancialDeps = Readonly<{
  pool: FinancialPool;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
  workerId?: string;
}>;

const UNIT_ID = "condition";
const SUBJECT_MENTION = "saved subject";
const LEASE_TTL_MS = 120_000;

type Translation =
  | Readonly<{ ok: true; draft: ReturnType<typeof conditionDraft>; freshness: number }>
  | Readonly<{ ok: false; reason: string }>;

/**
 * Translates one saved metric condition into a plan draft, exactly as saved.
 * The threshold's currency comes from the subject's own facts for the metric;
 * anything the verified definitions cannot express is unsupported.
 */
export async function translateThesisCondition(db: SqlExecutor, subjectId: string, metric: ThesisMetricCheck): Promise<Translation> {
  const definition = METRIC_CATALOG_V1.get(metric.metric_key);
  if (!definition) return { ok: false, reason: "metric_has_no_verified_definition" };
  const period = periodOperation(metric);
  if (period.operation === "unsupported") return { ok: false, reason: period.reason };
  if (metric.period_kind === "ttm" && definition.value_kind !== "flow") return { ok: false, reason: "trailing_sum_needs_a_flow_metric" };
  const unit = await thresholdUnit(db, subjectId, metric, definition.unit_kind);
  if (unit === null) return { ok: false, reason: "unit_does_not_match_definition" };
  return { ok: true, draft: conditionDraft(metric, unit), freshness: metric.max_age_days };
}

export type ThesisConditionRun = Readonly<{
  user_id: string;
  thesis: ThesisVersion;
  /** Identifies this assessment run; a retry with the same key resumes, never recomputes. */
  run_key: string;
  /** The pinned cutoff every condition is evaluated at. */
  as_of: string;
}>;

/** Assesses every metric condition of the thesis through the engine; narrative conditions are not touched. */
export async function evaluateFinancialThesisConditions(deps: ThesisFinancialDeps, run: ThesisConditionRun): Promise<ConditionAssessment[]> {
  const results: ConditionAssessment[] = [];
  for (const condition of run.thesis.conditions) {
    if (condition.metric === undefined) continue;
    results.push(await evaluateCondition(deps, run, condition, condition.metric));
  }
  return results;
}

/**
 * What a reuse decision may compare: status, cited facts, and the certified
 * result's hash (definition, inputs, and outcome) — never snapshot, run, or
 * certificate ids, which differ on every run even for identical evidence.
 */
export function thesisReuseProjection(results: ReadonlyArray<ConditionAssessment>) {
  return results.map((result) => ({
    condition_id: result.condition_id,
    status: result.status,
    fact_refs: [...result.fact_refs].sort(),
    result_hash: result.financial?.result_hash ?? null,
  }));
}

/** One saved numerical rule for one subject at one cutoff, with the parent's own authority and publication guard. */
export type VerifiedMetricSpec = Readonly<{
  authority: FinancialRuntimeAuthority;
  request_key: string;
  subject: Readonly<{ kind: "issuer"; id: string }>;
  metric: ThesisMetricCheck;
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

export type VerifiedMetricOutcome = Readonly<{
  status: "supported" | "challenged" | "unresolved";
  reason_code: string | null;
  reason: string;
  fact_refs: string[];
  financial: ConditionFinancialRef | null;
}>;

/**
 * The shared evaluation of a saved numerical rule — a thesis condition or an
 * approved Discovery criterion: plan it exactly as saved, compute and seal it
 * under the parent's authority, and read the outcome back from committed
 * records. A retry with the same request key resumes; it never recomputes.
 */
export async function evaluateVerifiedMetric(deps: ThesisFinancialDeps, spec: VerifiedMetricSpec): Promise<VerifiedMetricOutcome> {
  const client = snapshotTransactionClient(await deps.pool.connect());
  try {
    const earlier = await findRunForRequest(client, { authority: spec.authority, request_key: spec.request_key });
    let plan = earlier?.plan;
    if (!plan) {
      const translation = await translateThesisCondition(client, spec.subject.id, spec.metric);
      if (!translation.ok) return unresolvedOutcome(translation.reason);
      const planned = buildDeterministicPlan(
        await planningContext(client, spec, translation.freshness),
        translation.draft,
        [{ unit_id: UNIT_ID, output_ids: ["value", "predicate"] }],
      );
      if (planned.outcome !== "ready") return unresolvedOutcome(planned.outcome === "unsupported" ? "unsupported" : "configuration_needed");
      plan = planned.plan;
    }
    let outcome: PublishResult;
    try {
      outcome = await reserveAndPublish(client, {
        plan,
        authority: spec.authority,
        request_key: spec.request_key,
        worker_id: deps.workerId ?? `metric-${process.pid}`,
        ttl_ms: LEASE_TTL_MS,
        evidence: deps.evidence,
        parent_limits: {},
        persistParent: spec.persistParent,
      });
    } catch {
      return unresolvedOutcome("publication_failed");
    }
    if (outcome.status === "conflict") return unresolvedOutcome("request_conflict");
    if (outcome.status === "unavailable") {
      return unresolvedOutcome(outcome.reason === "busy" ? "run_in_progress" : outcome.reason === "parent_authority_required" ? "parent_authority_required" : "run_unavailable");
    }
    if (outcome.status === "cancelled" || outcome.status === "failed") return unresolvedOutcome(`run_${outcome.status}`);
    return committedOutcome(client, outcome.status === "driven" ? outcome.report.run_id : outcome.run.run_id);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------

async function evaluateCondition(deps: ThesisFinancialDeps, run: ThesisConditionRun, condition: ThesisCondition, metric: ThesisMetricCheck): Promise<ConditionAssessment> {
  const outcome = await evaluateVerifiedMetric(deps, {
    authority: thesisAuthority(run),
    request_key: `${run.run_key}:${condition.condition_id}`,
    subject: run.thesis.subject_ref,
    metric,
    as_of: run.as_of,
    reporting_basis: "as_restated",
    origin: { kind: "thesis_condition", ref: `thesis:${run.thesis.thesis_version_id}:${condition.condition_id}` },
    threshold_attribution: { kind: "saved_thesis_condition", ref: condition.condition_id },
    publication_unit_kind: "thesis_condition",
    persistParent: requireCurrentThesis(run.thesis.thesis_version_id),
  });
  return {
    condition_id: condition.condition_id,
    status: outcome.status,
    reason: outcome.reason,
    claim_refs: [],
    fact_refs: outcome.fact_refs,
    method: outcome.status === "unresolved" ? "no_evidence" : "metric",
    ...(outcome.financial ? { financial: outcome.financial } : {}),
  };
}

function thesisAuthority(run: ThesisConditionRun): FinancialRuntimeAuthority {
  return createRuntimeAuthority({
    owner_user_id: run.user_id,
    egress_channel: "thesis",
    // The saved thesis version is the parent: a new version is a new parent, never an edit of this one.
    parent: { kind: "thesis_version", id: run.thesis.thesis_version_id, version: `v${run.thesis.version}` },
    allowed_source_classes: ["sec_filing"],
    feature: { surface: "thesis", capability: "financial-condition", mode: "enforce" },
    approval_state: "not_required",
    lease: null,
  });
}

function periodOperation(metric: ThesisMetricCheck):
  | Readonly<{ operation: "reported_metric"; subject_slot: string; metric_key: string; period: Record<string, unknown> }>
  | Readonly<{ operation: "trailing_sum" }>
  | Readonly<{ operation: "unsupported"; reason: string }> {
  switch (metric.period_kind) {
    case "fiscal_y":
      return { operation: "reported_metric", subject_slot: "subject", metric_key: metric.metric_key, period: { kind: "latest", period_type: "annual", offset: 0 } };
    case "fiscal_q":
      return { operation: "reported_metric", subject_slot: "subject", metric_key: metric.metric_key, period: { kind: "latest", period_type: "quarterly", offset: 0 } };
    case "ttm":
      return { operation: "trailing_sum" };
    case "point":
      return { operation: "unsupported", reason: "point_in_time_metric_not_certified" };
  }
}

function conditionDraft(metric: ThesisMetricCheck, unit: FinancialUnit) {
  const quarter = (offset: number) => ({
    node_id: `quarter_${offset}`,
    operation: "reported_metric",
    subject_slot: "subject",
    metric_key: metric.metric_key,
    period: { kind: "latest", period_type: "quarterly", offset },
  });
  const value = metric.period_kind === "ttm"
    ? [quarter(0), quarter(1), quarter(2), quarter(3), { node_id: "value", operation: "trailing_sum", quarters: ["quarter_0", "quarter_1", "quarter_2", "quarter_3"] }]
    : [{ node_id: "value", ...(periodOperation(metric) as Record<string, unknown>) }];
  return {
    subjects: [{ slot_id: "subject", mention: SUBJECT_MENTION }],
    operations: [...value, { node_id: "predicate", operation: "threshold", subject: "value", threshold_id: "saved", comparison: metric.operator }],
    outputs: [{ output_id: "value", node_id: "value" }, { output_id: "predicate", node_id: "predicate" }],
    // The saved threshold, verbatim as exact decimal text.
    thresholds: [{ threshold_id: "saved", value: String(metric.threshold), unit }],
  };
}

async function thresholdUnit(db: SqlExecutor, subjectId: string, metric: ThesisMetricCheck, unitKind: FinancialUnit["kind"]): Promise<FinancialUnit | null> {
  if (unitKind !== "currency" && unitKind !== "currency_per_share") return metric.unit === unitKind ? { kind: unitKind } : null;
  // An ISO code saved as the unit names the currency; a generic currency unit takes the subject's own reporting currency.
  if (/^[A-Z]{3}$/u.test(metric.unit)) return { kind: unitKind, currency: metric.unit };
  if (metric.unit !== unitKind) return null;
  const currencies = (await db.query<{ currency: string }>(
    `select distinct f.currency from facts f join metrics m on m.metric_id = f.metric_id
      where f.subject_kind = 'issuer' and f.subject_id = $1::uuid and m.metric_key = $2 and f.currency is not null`,
    [subjectId, metric.metric_key],
  )).rows;
  return currencies.length === 1 ? { kind: unitKind, currency: currencies[0]!.currency } : null;
}

async function planningContext(db: SqlExecutor, spec: VerifiedMetricSpec, freshness: number): Promise<PlanningContext> {
  const name = (await db.query<{ legal_name: string }>(`select legal_name from issuers where issuer_id = $1::uuid`, [spec.subject.id])).rows[0]?.legal_name;
  return {
    plan_id: randomUUID(),
    origin: spec.origin,
    knowledge_cutoff: new Date(spec.as_of).toISOString(),
    cutoff_timezone: "UTC",
    reporting_basis: spec.reporting_basis,
    freshness_max_age_days: freshness,
    authority: spec.authority,
    parent_limits: {},
    max_model_calls: 0,
    requested_subjects: [{ mention: SUBJECT_MENTION, resolution: { status: "resolved", subject_ref: spec.subject, label: name ?? spec.subject.id } }],
    publication_unit_kind: spec.publication_unit_kind,
    threshold_attribution: spec.threshold_attribution,
  };
}

/** Seals the condition only while its thesis version is still the agent's current one, under the agent's lock. */
function requireCurrentThesis(thesisVersionId: string): PersistParentArtifact {
  return async (tx) => {
    const current = await tx.client.query<{ current: boolean }>(
      `select (select v2.thesis_version_id from agent_thesis_versions v2 where v2.agent_id = a.agent_id order by v2.version desc limit 1) = v.thesis_version_id as current
         from agent_thesis_versions v
         join agents a on a.agent_id = v.agent_id
        where v.thesis_version_id = $1::uuid and a.user_id = $2::uuid
        for update of a`,
      [thesisVersionId, tx.run.user_id],
    );
    if (current.rows[0]?.current !== true) throw new Error("the thesis changed during assessment");
  };
}

/** Reads the committed unit: the predicate's outcome, its result hash, the certificate, and the bound facts. */
async function committedOutcome(db: SqlExecutor, runId: string): Promise<VerifiedMetricOutcome> {
  const unit = (await db.query<{ state: string; snapshot_id: string | null; certificate_digest: string | null }>(
    `select state, snapshot_id::text, certificate_digest from financial_run_units where run_id = $1 and unit_id = $2`,
    [runId, UNIT_ID],
  )).rows[0];
  if (unit?.state !== "sealed") return unresolvedOutcome("verification_failed");
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
  const financial = { run_id: runId, unit_id: UNIT_ID, snapshot_id: unit.snapshot_id, certificate_digest: unit.certificate_digest, result_hash: predicate?.result_hash ?? null };
  if (predicate?.disposition !== "verified" || predicate.payload.kind !== "predicate") {
    // A predicate without a value is blocked; the value's own gap says why (e.g. older than the saved maximum age).
    const reasonCode = (value?.disposition !== "verified" ? value?.payload.reason_code : predicate?.payload.reason_code) ?? "no_result";
    return { ...unresolvedOutcome(reasonCode), fact_refs: facts, financial };
  }
  const met = predicate.payload.outcome === true;
  return {
    status: met ? "supported" : "challenged",
    reason_code: null,
    reason: met
      ? "The verified calculation at the assessment cutoff meets the saved threshold."
      : "The verified calculation at the assessment cutoff does not meet the saved threshold.",
    fact_refs: facts,
    financial,
  };
}

const UNRESOLVED_REASONS: Readonly<Record<string, string>> = {
  stale_input: "The latest eligible value is older than the saved maximum age at the assessment cutoff.",
  missing_input: "No eligible value was public at the assessment cutoff.",
  blocked_by_dependency: "No eligible value was public at the assessment cutoff.",
};

function unresolvedOutcome(reasonCode: string): VerifiedMetricOutcome {
  return {
    status: "unresolved",
    reason_code: reasonCode,
    reason: UNRESOLVED_REASONS[reasonCode] ?? `The saved rule could not be verified (${reasonCode}).`,
    fact_refs: [],
    financial: null,
  };
}
