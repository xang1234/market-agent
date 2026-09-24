// Dependency-injection ports for the financial engine. Adapters for evidence,
// definitions, models, and persistence are supplied by the host service; the
// engine never imports a feature's internal runtime, and the pure core never
// imports the engine.

import type {
  BoundFinancialInputV1,
  FinancialPlanV1,
  FinancialRuntimeAuthority,
  MetricKey,
  PlanningOutcome,
  ReasonCode,
  ReportedMetricNode,
  SubjectSlot,
  VersionTag,
} from "../../financial-core/src/index.ts";

export type Clock = () => Date;

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

export type InputCandidateRequest = {
  authority: FinancialRuntimeAuthority;
  plan: FinancialPlanV1;
  node: ReportedMetricNode;
  subject: SubjectSlot;
  /** Upper bound on candidates returned; truncation must be reported, never hidden. */
  limit: number;
};

export type InputCandidateSet =
  | { status: "ok"; candidates: ReadonlyArray<BoundFinancialInputV1>; truncated: boolean; candidate_set_digest: string }
  | { status: "gap"; reason_code: ReasonCode }
  | { status: "error"; reason_code: "provider_error" | "database_error" };

/**
 * Authorized evidence access. Implementations filter by owner, channel, source
 * deletion/entitlement, and promotion before returning any metadata.
 */
export interface FinancialEvidencePort {
  listInputCandidates(request: InputCandidateRequest): Promise<InputCandidateSet>;
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
