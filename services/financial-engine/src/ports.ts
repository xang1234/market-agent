// Dependency-injection ports for the financial engine. Adapters for evidence
// and persistence are supplied by the host service (the planner takes its
// model as a PlanningModel); the engine never imports a feature's internal
// runtime, and the pure core never imports the engine.

import type {
  AdjustmentBasis,
  DimensionScope,
  DisclosureRelation,
  FinancialRuntimeAuthority,
  FinancialSubjectRef,
  FinancialUnit,
  FiscalPeriod,
  MetricKey,
  PeriodType,
  PrecisionClass,
  PublicationTiming,
  ShareBasis,
} from "../../financial-core/src/index.ts";

/** Minimal SQL executor; hosts pass a pinned transaction client where atomicity matters. */
export type SqlExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
};

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
    period_type: PeriodType;
    dimension_scope: DimensionScope;
    dimension_members: ReadonlyArray<Readonly<{ axis: string; member: string }>>;
    adjustment_basis: AdjustmentBasis;
    share_basis: ShareBasis;
    fiscal_calendar_version: string;
    disclosure_relation: DisclosureRelation;
  }> | null;
  precision: Readonly<{
    precision_attestation_id: string;
    precision_class: PrecisionClass;
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
