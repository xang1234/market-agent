// Dependency-injection ports for the financial engine. Adapters for evidence,
// definitions, models, and persistence are supplied by the host service; the
// engine never imports a feature's internal runtime, and the pure core never
// imports the engine.

import type {
  FinancialRuntimeAuthority,
  FinancialSubjectRef,
  FinancialUnit,
  FiscalPeriod,
  MetricKey,
  PlanningOutcome,
  PublicationTiming,
  VersionTag,
} from "../../financial-core/src/index.ts";

export type Clock = () => Date;

/** Minimal SQL executor; hosts pass a pinned transaction client where atomicity matters. */
export type SqlExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
};

/** Server-resolved immutable metric definition. Models may only propose keys. */
export type ResolvedMetricDefinition = {
  metric_key: MetricKey;
  definition_version: VersionTag;
  definition_hash: string;
};

export interface FinancialDefinitionRegistry {
  catalogVersion(): VersionTag;
  resolveMetric(metricKey: MetricKey): ResolvedMetricDefinition | null;
}

/** One authorized evidence candidate, as the engine sees it (numerics as exact text). */
export type InputCandidate = Readonly<{
  fact_id: string;
  source_id: string;
  source_version_hash: string | null;
  metric_key: MetricKey;
  period: Readonly<{ start: string | null; end: string; fiscal_year: number; fiscal_period: FiscalPeriod }>;
  value_text: string;
  scale_text: string;
  /** Null when the stored unit has no financial-contract equivalent. */
  unit: FinancialUnit | null;
  method: "reported" | "extracted";
  verification_status: "authoritative" | "corroborated";
  observed_at: string;
  supersedes: string | null;
  superseded_by: string | null;
  context: Readonly<{
    period_type: "duration" | "instant";
    dimension_scope: "consolidated" | "segment";
    dimension_members: ReadonlyArray<Readonly<{ axis: string; member: string }>>;
    adjustment_basis: "unadjusted" | "split_adjusted";
    share_basis: "basic" | "diluted" | "not_applicable";
    fiscal_calendar_version: string;
    disclosure_relation: "original" | "economic_restatement" | "extraction_correction";
  }> | null;
  precision: Readonly<{
    precision_attestation_id: string;
    precision_class: "source_token_preserved" | "revalidated_against_source" | "legacy_unverified";
    raw_token: string | null;
    token_proof_hash: string | null;
    source_locator: string | null;
  }> | null;
  publication: ReadonlyArray<Readonly<{ attestation_id: string; timing: PublicationTiming }>>;
}>;

export type CandidateRequest = Readonly<{
  authority: FinancialRuntimeAuthority;
  subject: FinancialSubjectRef;
  metric_key: MetricKey;
  fiscal_year: number | null;
  fiscal_period: FiscalPeriod | null;
  limit: number;
}>;

export type CandidatePage =
  | Readonly<{ status: "ok"; candidates: ReadonlyArray<InputCandidate>; truncated: boolean }>
  | Readonly<{ status: "error"; reason_code: "database_error" | "provider_error" }>;

/**
 * Authorized evidence access. Implementations apply owner, channel, source
 * deletion/entitlement, invalidation, and promotion rules before returning
 * anything; the public-information mode never admits private sources.
 */
export interface FinancialEvidencePort {
  listInputCandidates(request: CandidateRequest): Promise<CandidatePage>;
}

/**
 * Planner model adapter over the existing model router. Its output is
 * untrusted JSON that must pass validateFinancialPlan before any acquisition.
 */
export interface FinancialPlannerModelPort {
  proposePlan(input: {
    request_text: string;
    catalog_version: VersionTag;
    allow_schema_repair: boolean;
  }): Promise<{ outcome: PlanningOutcome; proposal: unknown }>;
}
