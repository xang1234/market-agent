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
    // Attributable to the parent, as EPS is: us-gaap NetIncomeLoss, or ProfitLoss
    // for a period with no noncontrolling interest. Net margin divides it.
    metric("net_income", "Net income", "flow", "currency"),
    // us-gaap ProfitLoss, or NetIncomeLoss for a period with no noncontrolling
    // interest. OCF is consolidated, so cash conversion divides by this.
    metric("net_income_consolidated", "Net income including noncontrolling interest", "flow", "currency"),
    // Including discontinued operations, like capex (SEC ingestion certifies
    // only NetCashProvidedByUsedInOperatingActivities).
    metric("operating_cash_flow", "Operating cash flow", "flow", "currency"),
    // Cash paid for PP&E, reported as a nonnegative outflow (SEC ingestion
    // certifies only PaymentsToAcquirePropertyPlantAndEquipment).
    metric("capex", "Capital expenditures (PP&E cash payments)", "flow", "currency"),
    // A Call's inputs (ADR 0005), each one reported us-gaap concept (#594),
    // never a sum of tags: net cash and total debt sum them (BALANCE_COMPONENTS).
    // Income from continuing operations before income taxes, including equity-method income.
    metric("pretax_income", "Pretax income (including equity-method income)", "flow", "currency"),
    // The figure a filer that reports affiliates' profit after tax (CAT) tags instead.
    metric("pretax_income_before_equity_method", "Pretax income before equity-method income", "flow", "currency"),
    metric("income_tax_expense", "Income tax expense (benefit)", "flow", "currency"),
    // The expense recognized; it can differ from the cash flow add-back.
    metric("stock_based_compensation_expense", "Stock-based compensation expense", "flow", "currency"),
    metric("stock_based_compensation", "Stock-based compensation (cash flow add-back)", "flow", "currency"),
    metric("eps_basic", "EPS (basic)", "per_share", "currency_per_share", "basic"),
    metric("eps_diluted", "EPS (diluted)", "per_share", "currency_per_share", "diluted"),
    metric("weighted_average_basic_shares", "Weighted-average basic shares", "share_count_average", "shares", "basic"),
    metric("weighted_average_diluted_shares", "Weighted-average diluted shares", "share_count_average", "shares", "diluted"),
    metric("cash_and_equivalents", "Cash and equivalents (excluding restricted cash)", "balance", "currency"),
    // Each investment concept is its own figure: marketable securities may hold
    // equities, debt securities hold none, short-term investments may hold time deposits.
    metric("marketable_securities_current", "Marketable securities (current)", "balance", "currency"),
    metric("marketable_securities_noncurrent", "Marketable securities (noncurrent)", "balance", "currency"),
    metric("debt_securities_current", "Debt securities (current)", "balance", "currency"),
    metric("short_term_investments", "Short-term investments", "balance", "currency"),
    metric("long_term_debt_current", "Long-term debt (current portion)", "balance", "currency"),
    metric("long_term_debt_noncurrent", "Long-term debt (noncurrent)", "balance", "currency"),
    metric("commercial_paper", "Commercial paper", "balance", "currency"),
    metric("short_term_borrowings", "Short-term borrowings", "balance", "currency"),
    metric("remaining_performance_obligations", "Remaining performance obligations", "balance", "currency"),
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
      definition_version: "operating_cash_flow_to_net_income.v2",
      label: "Cash conversion: operating cash flow / net income including noncontrolling interest (reported period)",
      numerator: "operating_cash_flow",
      denominator: "net_income_consolidated",
      denominator_constraint: "positive" as const,
      timing: "same_duration" as const,
    },
  ].map((definition) => [definition.ratio_key, Object.freeze(definition)]),
);

export type BalanceSide = "cash" | "debt";

/**
 * A balance net cash and total debt read (ADR 0006): its side, whether the
 * definition needs it, and the keys that would count one balance-sheet line
 * twice beside it on one date. Leases, equity investments, restricted cash,
 * pensions and finance-arm receivables are not components.
 */
export type BalanceComponent = Readonly<{ metric_key: MetricKey; side: BalanceSide; required: boolean; excludes?: ReadonlyArray<MetricKey> }>;

export const BALANCE_COMPONENTS = [
  { metric_key: "cash_and_equivalents", side: "cash", required: true },
  { metric_key: "marketable_securities_current", side: "cash", required: false },
  { metric_key: "marketable_securities_noncurrent", side: "cash", required: false },
  { metric_key: "short_term_investments", side: "cash", required: false, excludes: ["marketable_securities_current"] },
  { metric_key: "debt_securities_current", side: "cash", required: false, excludes: ["marketable_securities_current"] },
  { metric_key: "long_term_debt_current", side: "debt", required: false },
  { metric_key: "long_term_debt_noncurrent", side: "debt", required: false },
  { metric_key: "commercial_paper", side: "debt", required: false },
  { metric_key: "short_term_borrowings", side: "debt", required: false },
] as const satisfies ReadonlyArray<BalanceComponent>;

export type BalanceSumKind = "net_cash" | "total_debt";

/** How each side's balances enter the figure. Every side needs at least one balance reported. */
export const BALANCE_SUM_SIDES: Readonly<Record<BalanceSumKind, Readonly<Partial<Record<BalanceSide, "add" | "subtract">>>>> = Object.freeze({
  net_cash: { cash: "add", debt: "subtract" },
  total_debt: { debt: "add" },
});

/** A balance sum's components, in table order: its plan node's dependency order. */
export function balanceComponents(kind: BalanceSumKind): ReadonlyArray<BalanceComponent> {
  return BALANCE_COMPONENTS.filter((component) => Object.hasOwn(BALANCE_SUM_SIDES[kind], component.side));
}

export function resolveMetricDefinition(metricKey: MetricKey): MetricDefinition | null {
  return METRIC_CATALOG_V1.get(metricKey) ?? null;
}

export function resolveRatioDefinition(ratioKey: MetricKey): RatioDefinition | null {
  return RATIO_CATALOG_V1.get(ratioKey) ?? null;
}
