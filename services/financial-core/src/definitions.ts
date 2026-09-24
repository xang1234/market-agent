// Approved financial definitions, catalog v1. Models may propose metric keys;
// only these reviewed definitions resolve. No executable user rules.

import type { FinancialUnit, MetricKey, OperationKind, VersionTag } from "./contracts.ts";

export const FINANCIAL_CATALOG_VERSION = "catalog.v1";

/**
 * flow: duration value, additive across contiguous periods (revenue).
 * balance: instant value, never summed across periods (total assets).
 * per_share / share_count_average: duration values that are not additive (EPS,
 * weighted-average shares).
 * share_count: instant share count.
 */
export type MetricValueKind = "flow" | "balance" | "per_share" | "share_count_average" | "share_count";

export type MetricDefinition = Readonly<{
  metric_key: MetricKey;
  definition_version: VersionTag;
  label: string;
  value_kind: MetricValueKind;
  additive: boolean;
  unit_kind: FinancialUnit["kind"];
  share_basis: "basic" | "diluted" | "not_applicable";
}>;

function metric(
  metric_key: MetricKey,
  label: string,
  value_kind: MetricValueKind,
  unit_kind: FinancialUnit["kind"],
  share_basis: MetricDefinition["share_basis"] = "not_applicable",
): MetricDefinition {
  return Object.freeze({
    metric_key,
    definition_version: `${metric_key}.v1`,
    label,
    value_kind,
    additive: value_kind === "flow",
    unit_kind,
    share_basis,
  });
}

export const METRIC_CATALOG_V1: ReadonlyMap<MetricKey, MetricDefinition> = new Map(
  [
    metric("revenue", "Revenue", "flow", "currency"),
    metric("gross_profit", "Gross profit", "flow", "currency"),
    metric("operating_income", "Operating income", "flow", "currency"),
    metric("net_income", "Net income", "flow", "currency"),
    metric("operating_cash_flow", "Operating cash flow", "flow", "currency"),
    metric("eps_basic", "EPS (basic)", "per_share", "currency_per_share", "basic"),
    metric("eps_diluted", "EPS (diluted)", "per_share", "currency_per_share", "diluted"),
    metric("weighted_average_diluted_shares", "Weighted-average diluted shares", "share_count_average", "shares", "diluted"),
    metric("total_assets", "Total assets", "balance", "currency"),
    metric("total_liabilities", "Total liabilities", "balance", "currency"),
    metric("stockholders_equity", "Stockholders' equity", "balance", "currency"),
    metric("shares_outstanding", "Shares outstanding", "share_count", "shares"),
  ].map((definition) => [definition.metric_key, definition]),
);

/** Margins: approved numerator over positive revenue in the identical period, scope, and basis. */
export const MARGIN_NUMERATORS: Readonly<Record<"gross_margin" | "operating_margin" | "net_margin", MetricKey>> = Object.freeze({
  gross_margin: "gross_profit",
  operating_margin: "operating_income",
  net_margin: "net_income",
});

export type RatioDefinition = Readonly<{
  ratio_key: MetricKey;
  definition_version: VersionTag;
  label: string;
  numerator: MetricKey;
  denominator: MetricKey;
  denominator_constraint: "positive";
  timing: "same_instant" | "same_duration";
}>;

/** Only approved metric pairs; `ratio` is not arbitrary division. */
export const RATIO_CATALOG_V1: ReadonlyMap<MetricKey, RatioDefinition> = new Map(
  [
    {
      ratio_key: "liabilities_to_assets",
      definition_version: "liabilities_to_assets.v1",
      label: "Total liabilities / total assets",
      numerator: "total_liabilities",
      denominator: "total_assets",
      denominator_constraint: "positive" as const,
      timing: "same_instant" as const,
    },
    {
      ratio_key: "liabilities_to_equity",
      definition_version: "liabilities_to_equity.v1",
      label: "Total liabilities / stockholders' equity",
      numerator: "total_liabilities",
      denominator: "stockholders_equity",
      denominator_constraint: "positive" as const,
      timing: "same_instant" as const,
    },
    {
      ratio_key: "operating_cash_flow_to_net_income",
      definition_version: "operating_cash_flow_to_net_income.v1",
      label: "Operating cash flow / net income",
      numerator: "operating_cash_flow",
      denominator: "net_income",
      denominator_constraint: "positive" as const,
      timing: "same_duration" as const,
    },
  ].map((definition) => [definition.ratio_key, Object.freeze(definition)]),
);

export type OperationDefinition = Readonly<{
  operation: OperationKind;
  operation_version: VersionTag;
  interpretation: string;
  /** How the published value is represented. */
  precision_rule: "exact" | "exact_or_policy_rounded" | "predicate";
  /** peer_compare evaluates the available members and reports incompleteness. */
  tolerates_missing_dependencies: boolean;
}>;

function operation(
  kind: OperationKind,
  interpretation: string,
  precision_rule: OperationDefinition["precision_rule"],
  tolerates_missing_dependencies = false,
): OperationDefinition {
  return Object.freeze({
    operation: kind,
    operation_version: `${kind}.v1`,
    interpretation,
    precision_rule,
    tolerates_missing_dependencies,
  });
}

export const OPERATION_CATALOG_V1: ReadonlyMap<OperationKind, OperationDefinition> = new Map(
  [
    operation("reported_metric", "Eligible reported value for the exact subject, metric, period, and basis.", "exact"),
    operation("absolute_change", "Current minus prior for compatible periods, units, scope, and basis.", "exact"),
    operation("percent_change_positive_base", "(current - prior) / prior, defined only for a positive prior value.", "exact_or_policy_rounded"),
    operation("gross_margin", "Gross profit / revenue for the identical period, scope, and basis; revenue must be positive.", "exact_or_policy_rounded"),
    operation("operating_margin", "Operating income / revenue for the identical period, scope, and basis; revenue must be positive.", "exact_or_policy_rounded"),
    operation("net_margin", "Net income / revenue for the identical period, scope, and basis; revenue must be positive.", "exact_or_policy_rounded"),
    operation("ratio", "Approved metric pair with an explicit denominator constraint and timing.", "exact_or_policy_rounded"),
    operation("trailing_sum", "Sum of four consecutive, non-overlapping fiscal quarters of an additive flow metric.", "exact"),
    operation("threshold", "Exact comparison with an attributed threshold in compatible units.", "predicate"),
    operation("peer_compare", "Ranking of a frozen cohort on identical definitions and periods; ties explicit.", "predicate", true),
  ].map((definition) => [definition.operation, definition]),
);

export function resolveMetricDefinition(metricKey: MetricKey): MetricDefinition | null {
  return METRIC_CATALOG_V1.get(metricKey) ?? null;
}

export function resolveRatioDefinition(ratioKey: MetricKey): RatioDefinition | null {
  return RATIO_CATALOG_V1.get(ratioKey) ?? null;
}
