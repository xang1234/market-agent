// Versioned financial contracts. The JSON Schemas in spec/financial_plan_schema.json
// and spec/financial_result_schema.json are the serialized-boundary authority;
// these types mirror them (test/contracts.test.ts keeps the enums in sync).

export type UUID = string;
/** Plan-local identifier: ^[a-z][a-z0-9_]{0,63}$ */
export type LocalId = string;
export type MetricKey = string;
export type VersionTag = string;
export type Sha256Hex = string;
/** Canonical finite decimal text. Financial amounts never travel as JSON numbers. */
export type DecimalString = string;
export type IsoDate = string;
export type IsoDateTime = string;

export const FINANCIAL_PLAN_SCHEMA_VERSION = "financial_plan.v1";
export const FINANCIAL_RESULT_SCHEMA_VERSION = "financial_result.v1";
export const BOUND_INPUT_SCHEMA_VERSION = "financial_bound_input.v1";

export const OPERATION_KINDS = [
  "reported_metric",
  "absolute_change",
  "percent_change_positive_base",
  "gross_margin",
  "operating_margin",
  "net_margin",
  "ratio",
  "trailing_sum",
  "threshold",
  "peer_compare",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export const COMPARISONS = ["gt", "gte", "lt", "lte", "eq"] as const;
export type Comparison = (typeof COMPARISONS)[number];

export const REPORTING_BASES = ["as_reported", "as_restated"] as const;
export type ReportingBasis = (typeof REPORTING_BASES)[number];

export const FISCAL_PERIODS = ["FY", "Q1", "Q2", "Q3", "Q4"] as const;
export type FiscalPeriod = (typeof FISCAL_PERIODS)[number];

export const PUBLICATION_UNIT_KINDS = [
  "chat_section",
  "analyze_section",
  "grid_cell",
  "thesis_condition",
  "discovery_assessment",
] as const;
export type PublicationUnitKind = (typeof PUBLICATION_UNIT_KINDS)[number];

export const SURFACES = ["chat", "analyze", "analyst_grid", "thesis", "discovery"] as const;
export type Surface = (typeof SURFACES)[number];

export const FEATURE_MODES = ["off", "shadow", "enforce"] as const;
export type FeatureMode = (typeof FEATURE_MODES)[number];

export const PLANNING_OUTCOMES = ["ready", "needs_clarification", "unsupported"] as const;
export type PlanningOutcome = (typeof PLANNING_OUTCOMES)[number];

export const GAP_DISPOSITIONS = [
  "missing",
  "unsupported",
  "not_applicable",
  "undefined",
  "incompatible",
  "blocked_dependency",
  "execution_error",
] as const;
export type GapDisposition = (typeof GAP_DISPOSITIONS)[number];

/** Public dispositions. `verified` is awarded only by server finalization. */
export const RESULT_DISPOSITIONS = ["verified", ...GAP_DISPOSITIONS] as const;
export type ResultDisposition = (typeof RESULT_DISPOSITIONS)[number];

export const COVERAGE_STATES = ["complete", "partial", "none"] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];

export const REASON_CODES = [
  "missing_input",
  "stale_input",
  "publication_time_unknown",
  "precision_unverified",
  "conflicting_evidence",
  "reconciliation_required",
  "incompatible_period",
  "incompatible_unit",
  "incompatible_currency",
  "incompatible_scope",
  "incompatible_basis",
  "incompatible_definition",
  "non_positive_base",
  "zero_denominator",
  "non_positive_denominator",
  "non_additive_metric",
  "incomplete_quarter_set",
  "overlapping_periods",
  "unsupported_operation",
  "unsupported_metric",
  "unsupported_period",
  "blocked_by_dependency",
  "incomplete_cohort",
  "scope_limit_exceeded",
  "numeric_limit_exceeded",
  "precision_indeterminate",
  "provider_error",
  "database_error",
  "integrity_failure",
  "replay_version_unavailable",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const UNIT_KINDS = [
  "currency",
  "currency_per_share",
  "shares",
  "ratio",
  "percent",
  "percentage_points",
  "basis_points",
  "count",
] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export type FinancialUnit =
  | { kind: "currency" | "currency_per_share"; currency: string }
  | { kind: "shares" | "ratio" | "percent" | "percentage_points" | "basis_points" | "count" };

export type FinancialSubjectRef = { kind: "issuer" | "listing"; id: UUID };

export type SubjectSlot = {
  slot_id: LocalId;
  subject_ref: FinancialSubjectRef;
  display_order: number;
  role: "primary" | "peer";
};

export type SubjectSet = {
  membership: "explicit" | "frozen_peer_set";
  requested_count: number;
  resolved_count: number;
  omitted_count: number;
  members: SubjectSlot[];
};

export type TimeContext = {
  knowledge_cutoff: IsoDateTime;
  cutoff_timezone: string;
  time_mode: "public_information";
};

export type PlanPolicies = {
  reporting_basis: ReportingBasis;
  period_policy: "exact_fiscal";
  freshness: { max_age_days: number | null };
  source_policy_version: VersionTag;
};

export type PeriodSelector =
  | { kind: "fiscal_period"; fiscal_year: number; fiscal_period: FiscalPeriod }
  | { kind: "latest"; period_type: "annual" | "quarterly"; offset: number };

type NodeBase = { node_id: LocalId; operation_version: VersionTag };

export type ReportedMetricNode = NodeBase & {
  operation: "reported_metric";
  subject_slot: LocalId;
  metric_key: MetricKey;
  period: PeriodSelector;
};
export type ChangeNode = NodeBase & {
  operation: "absolute_change" | "percent_change_positive_base";
  current: LocalId;
  prior: LocalId;
};
export type MarginNode = NodeBase & {
  operation: "gross_margin" | "operating_margin" | "net_margin";
  numerator: LocalId;
  revenue: LocalId;
};
export type RatioNode = NodeBase & {
  operation: "ratio";
  ratio_key: MetricKey;
  numerator: LocalId;
  denominator: LocalId;
};
export type TrailingSumNode = NodeBase & { operation: "trailing_sum"; quarters: LocalId[] };
export type ThresholdNode = NodeBase & {
  operation: "threshold";
  subject: LocalId;
  threshold_id: LocalId;
  comparison: Comparison;
};
export type PeerCompareNode = NodeBase & {
  operation: "peer_compare";
  members: LocalId[];
  direction: "highest" | "lowest";
};

export type OperationNode =
  | ReportedMetricNode
  | ChangeNode
  | MarginNode
  | RatioNode
  | TrailingSumNode
  | ThresholdNode
  | PeerCompareNode;

export type RequestedOutput = { output_id: LocalId; node_id: LocalId; unit_id: LocalId };
export type PublicationUnit = { unit_id: LocalId; kind: PublicationUnitKind };

export type ThresholdAttribution = {
  kind: "user_request" | "saved_thesis_condition" | "approved_discovery_brief" | "grid_configuration";
  ref: string;
};
export type PlanThreshold = {
  threshold_id: LocalId;
  value: DecimalString;
  unit: FinancialUnit;
  attribution: ThresholdAttribution;
};

export type ExecutionLimits = {
  max_subjects: number;
  max_periods_per_subject: number;
  max_operations: number;
  max_outputs: number;
  max_input_candidates: number;
  max_concurrent_evidence_tasks: number;
};

/** Versioned design defaults (spec §10.1). Lower plan or parent limits win. */
export const DEFAULT_EXECUTION_LIMITS: Readonly<ExecutionLimits> = Object.freeze({
  max_subjects: 25,
  max_periods_per_subject: 20,
  max_operations: 512,
  max_outputs: 2000,
  max_input_candidates: 10000,
  max_concurrent_evidence_tasks: 4,
});

export type PlannerProvenance = {
  kind: "model" | "deterministic";
  adapter_version: VersionTag;
  model: string | null;
  prompt_version: VersionTag | null;
};

export type PlanOrigin = {
  kind: "chat_request" | "analyze_section" | "grid_run" | "thesis_condition" | "discovery_criterion" | "api_request";
  ref: string;
};

export type FinancialPlanV1 = {
  schema_version: typeof FINANCIAL_PLAN_SCHEMA_VERSION;
  plan_id: UUID;
  origin: PlanOrigin;
  planner: PlannerProvenance;
  catalog_version: VersionTag;
  /** Generated from the validated structure (T11); never free model prose. */
  interpretation: { generator_version: VersionTag; text: string } | null;
  subjects: SubjectSet;
  time: TimeContext;
  policies: PlanPolicies;
  metric_definitions: Array<{ metric_key: MetricKey; definition_version: VersionTag }>;
  operations: OperationNode[];
  outputs: RequestedOutput[];
  publication_units: PublicationUnit[];
  thresholds: PlanThreshold[];
  limits: ExecutionLimits;
  presentation_template_version: VersionTag;
};

// ---------------------------------------------------------------------------
// Server-only runtime authority. Never part of a plan and never model-supplied.

declare const runtimeAuthorityBrand: unique symbol;

export type FinancialRuntimeAuthorityV1 = {
  owner_user_id: UUID;
  egress_channel: Surface | "api";
  parent: {
    kind: "chat_thread" | "analyze_memo_run" | "analyst_grid_run" | "thesis_version" | "discovery_run";
    id: UUID;
    version: string;
  };
  allowed_source_classes: Array<"sec_filing" | "issuer_disclosure" | "licensed_fundamentals" | "market_data">;
  feature: { surface: Surface; capability: VersionTag; mode: FeatureMode };
  approval_state: "approved" | "not_required";
  lease: { epoch: number; fence_token: string } | null;
};

/** Brand aids callers; serialized boundaries are still validated. */
export type FinancialRuntimeAuthority = Readonly<FinancialRuntimeAuthorityV1> & {
  readonly [runtimeAuthorityBrand]: true;
};

// ---------------------------------------------------------------------------
// Results

export type ValuePayload = {
  kind: "value";
  value: DecimalString;
  unit: FinancialUnit;
  /** False when the value is a rounded representation (e.g. repeating division). */
  exact: boolean;
  rounding: { policy_version: VersionTag; significant_digits: number; mode: "half_even" } | null;
};
export type PredicatePayload = {
  kind: "predicate";
  predicate: "threshold";
  comparison: Comparison;
  outcome: boolean;
};
export type RankingPayload = {
  kind: "ranking";
  direction: "highest" | "lowest";
  population: { requested: number; evaluated: number };
  complete: boolean;
  ranks: Array<{ node_id: LocalId; rank: number }>;
  /** Tied leaders; null whenever the cohort is incomplete. */
  extreme: LocalId[] | null;
};
export type GapPayload = { kind: "gap"; reason_code: ReasonCode; explanation: string };
export type SuccessPayload = ValuePayload | PredicatePayload | RankingPayload;

type ResultIdentity = {
  schema_version: typeof FINANCIAL_RESULT_SCHEMA_VERSION;
  result_id: UUID;
  output_id: LocalId;
  node_id: LocalId;
  unit_id: LocalId;
  dependencies: LocalId[];
};

export type DraftFinancialResultV1 = ResultIdentity & { state: "draft" } & (
  | { disposition: "computed"; payload: SuccessPayload }
  | { disposition: GapDisposition; payload: GapPayload }
);

export type FinalizedFinancialResultV1 = ResultIdentity & { state: "finalized"; result_hash: Sha256Hex } & (
  | { disposition: "verified"; payload: SuccessPayload }
  | { disposition: GapDisposition; payload: GapPayload }
);

// ---------------------------------------------------------------------------
// Bound inputs

export type BoundFinancialInputV1 = {
  schema_version: typeof BOUND_INPUT_SCHEMA_VERSION;
  input_slot: LocalId;
  fact_id: UUID;
  subject_ref: FinancialSubjectRef;
  metric: { metric_key: MetricKey; definition_version: VersionTag };
  source: {
    source_id: UUID;
    document_id: UUID | null;
    source_version_hash: Sha256Hex;
    locator: string | null;
  };
  numeric: {
    raw_token: string;
    token_proof_hash: Sha256Hex;
    value: DecimalString;
    scale: DecimalString;
    native_value: DecimalString;
  };
  unit: FinancialUnit;
  period: {
    kind: "duration" | "instant";
    start: IsoDate | null;
    end: IsoDate;
    fiscal_year: number;
    fiscal_period: FiscalPeriod;
    calendar_version: VersionTag;
  };
  dimensions: {
    scope: "consolidated" | "segment";
    members: Array<{ axis: string; member: string }>;
  };
  basis: {
    reporting: ReportingBasis;
    adjustment: "unadjusted" | "split_adjusted";
    share_basis: "basic" | "diluted" | "not_applicable";
  };
  publication: {
    attestation_id: UUID;
    available_no_later_than: IsoDateTime;
    precision: "instant" | "date" | "observed_public";
    source_timezone: string;
  };
  observed_at: IsoDateTime;
  precision_status: "source_token_preserved" | "revalidated_against_source";
  eligibility: {
    selection_policy_version: VersionTag;
    promotion_status: "authoritative" | "corroborated" | "reviewed_extraction";
    candidate_set_digest: Sha256Hex;
  };
};

/** Explicit dependency edges of an operation node, in declared order. */
export function operationDependencies(node: OperationNode): LocalId[] {
  switch (node.operation) {
    case "reported_metric":
      return [];
    case "absolute_change":
    case "percent_change_positive_base":
      return [node.current, node.prior];
    case "gross_margin":
    case "operating_margin":
    case "net_margin":
      return [node.numerator, node.revenue];
    case "ratio":
      return [node.numerator, node.denominator];
    case "trailing_sum":
      return [...node.quarters];
    case "threshold":
      return [node.subject];
    case "peer_compare":
      return [...node.members];
  }
}
