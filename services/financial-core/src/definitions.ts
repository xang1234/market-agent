// Approved financial definitions, catalog v1. Models may propose metric keys;
// only these reviewed definitions resolve. No executable user rules.

import type { FinancialUnit, MetricKey, VersionTag } from "./contracts.ts";
import type { ShareBasis } from "./evidence-vocabulary.ts";

export const FINANCIAL_CATALOG_VERSION = "catalog.v1";

/**
 * flow: duration value, additive across contiguous quarters (revenue); the
 * only kind trailing_sum accepts.
 * balance: instant value, never summed across periods (total assets).
 * per_share / share_count_average: duration values that are not additive (EPS,
 * weighted-average shares).
 * share_count: instant share count.
 * price: a share price at an instant, bound from a price observation, never a fact.
 */
export type MetricValueKind = "flow" | "balance" | "per_share" | "share_count_average" | "share_count" | "price";

export type MetricDefinition = Readonly<{
  metric_key: MetricKey;
  definition_version: VersionTag;
  label: string;
  value_kind: MetricValueKind;
  unit_kind: FinancialUnit["kind"];
  share_basis: ShareBasis;
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
    // Including discontinued operations, like capex (SEC ingestion certifies
    // only NetCashProvidedByUsedInOperatingActivities).
    metric("operating_cash_flow", "Operating cash flow", "flow", "currency"),
    // Cash paid for PP&E, reported as a nonnegative outflow (SEC ingestion
    // certifies only PaymentsToAcquirePropertyPlantAndEquipment).
    metric("capex", "Capital expenditures (PP&E cash payments)", "flow", "currency"),
    metric("eps_basic", "EPS (basic)", "per_share", "currency_per_share", "basic"),
    metric("eps_diluted", "EPS (diluted)", "per_share", "currency_per_share", "diluted"),
    metric("weighted_average_basic_shares", "Weighted-average basic shares", "share_count_average", "shares", "basic"),
    metric("weighted_average_diluted_shares", "Weighted-average diluted shares", "share_count_average", "shares", "diluted"),
    metric("cash_and_equivalents", "Cash and equivalents (excluding restricted cash)", "balance", "currency"),
    metric("total_assets", "Total assets", "balance", "currency"),
    metric("total_liabilities", "Total liabilities", "balance", "currency"),
    // Keyed as stored: SEC ingestion maps us-gaap StockholdersEquity (parent
    // equity, before noncontrolling interest) to total_equity.
    metric("total_equity", "Stockholders' equity", "balance", "currency"),
    metric("shares_outstanding", "Shares outstanding", "share_count", "shares"),
    metric("share_price", "Share price", "price", "currency_per_share"),
  ].map((definition) => [definition.metric_key, definition]),
);

/**
 * The metrics a planner offers on their own. A share price is planned only as
 * the price of a valuation (market_cap, pe_ratio), so it is left out: the model
 * planner's prompt names it with the valuations, and chat routes valuations,
 * never a bare price.
 */
export const PLANNABLE_METRICS: ReadonlyArray<MetricDefinition> = [...METRIC_CATALOG_V1.values()].filter((definition) => definition.value_kind !== "price");

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
      label: "Total liabilities / total assets (period-end balance sheet)",
      numerator: "total_liabilities",
      denominator: "total_assets",
      denominator_constraint: "positive" as const,
      timing: "same_instant" as const,
    },
    {
      ratio_key: "liabilities_to_equity",
      definition_version: "liabilities_to_equity.v1",
      label: "Total liabilities / stockholders' equity (period-end balance sheet)",
      numerator: "total_liabilities",
      denominator: "total_equity",
      denominator_constraint: "positive" as const,
      timing: "same_instant" as const,
    },
    {
      ratio_key: "operating_cash_flow_to_net_income",
      definition_version: "operating_cash_flow_to_net_income.v1",
      label: "Cash conversion: operating cash flow / net income (reported period)",
      numerator: "operating_cash_flow",
      denominator: "net_income",
      denominator_constraint: "positive" as const,
      timing: "same_duration" as const,
    },
  ].map((definition) => [definition.ratio_key, Object.freeze(definition)]),
);

export function resolveMetricDefinition(metricKey: MetricKey): MetricDefinition | null {
  return METRIC_CATALOG_V1.get(metricKey) ?? null;
}

export function resolveRatioDefinition(ratioKey: MetricKey): RatioDefinition | null {
  return RATIO_CATALOG_V1.get(ratioKey) ?? null;
}
