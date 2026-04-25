import type { IssuerSubjectRef } from "../src/subject-ref.ts";
import type { NormalizedStatementInput, StatementLine } from "../src/statement.ts";
import {
  createMetricRegistry,
  type MetricDefinition,
  type MetricRegistry,
} from "../src/metric-mapper.ts";

// Issuer-anchored: AAPL the reporting entity, not its XNAS listing.
export const aaplIssuer: IssuerSubjectRef = {
  kind: "issuer",
  id: "22222222-2222-4222-a222-222222222222",
};

export const SEC_EDGAR_SOURCE_ID = "00000000-0000-4000-a000-0000000000ed";

// AAPL FY2024 income statement, from the 10-K filed 2024-11-01 covering
// the fiscal year ended 2024-09-28. Reported in millions of USD; EPS lines
// use scale=1 so the millions multiplier doesn't propagate per-share.
const AAPL_FY2024_INCOME_LINES: StatementLine[] = [
  {
    metric_key: "net_sales.products",
    value_num: 294_866,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "net_sales.services",
    value_num: 96_169,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "net_sales.total",
    value_num: 391_035,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "cost_of_sales.products",
    value_num: 185_233,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "cost_of_sales.services",
    value_num: 25_119,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "cost_of_sales.total",
    value_num: 210_352,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "gross_profit",
    value_num: 180_683,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "operating_expenses.research_and_development",
    value_num: 31_370,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "operating_expenses.selling_general_and_administrative",
    value_num: 26_097,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "operating_expenses.total",
    value_num: 57_467,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "operating_income",
    value_num: 123_216,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "other_income_net",
    value_num: 269,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "income_before_taxes",
    value_num: 123_485,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "income_tax_expense",
    value_num: 29_749,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "net_income",
    value_num: 93_736,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  },
  {
    metric_key: "eps.basic",
    value_num: 6.11,
    unit: "currency_per_share",
    currency: "USD",
    scale: 1,
    coverage_level: "full",
  },
  {
    metric_key: "eps.diluted",
    value_num: 6.08,
    unit: "currency_per_share",
    currency: "USD",
    scale: 1,
    coverage_level: "full",
  },
  {
    metric_key: "weighted_average_shares.basic",
    value_num: 15_343_783,
    unit: "shares",
    scale: 1_000,
    coverage_level: "full",
  },
  {
    metric_key: "weighted_average_shares.diluted",
    value_num: 15_408_095,
    unit: "shares",
    scale: 1_000,
    coverage_level: "full",
  },
];

export function aaplFy2024IncomeStatementInput(): NormalizedStatementInput {
  return {
    subject: aaplIssuer,
    family: "income",
    basis: "as_reported",
    period_kind: "fiscal_y",
    period_start: "2023-10-01",
    period_end: "2024-09-28",
    fiscal_year: 2024,
    fiscal_period: "FY",
    reporting_currency: "USD",
    as_of: "2024-11-01T20:30:00.000Z",
    reported_at: "2024-11-01T20:30:00.000Z",
    source_id: SEC_EDGAR_SOURCE_ID,
    lines: AAPL_FY2024_INCOME_LINES.map((l) => ({ ...l })),
  };
}

export const AAPL_FY2024_KNOWN_VALUES = {
  net_sales_total: 391_035_000_000,
  cost_of_sales_total: 210_352_000_000,
  gross_profit: 180_683_000_000,
  operating_income: 123_216_000_000,
  net_income: 93_736_000_000,
  eps_basic: 6.11,
  eps_diluted: 6.08,
} as const;

// Canonical metric definitions for the AAPL income statement. The metric_id
// UUIDs are stable test fixtures: a real deployment seeds the `metrics`
// table from a migration, but the mapper's contract (key → id, every line
// resolves) is testable from in-memory definitions alone.
export const AAPL_INCOME_METRIC_DEFINITIONS: ReadonlyArray<MetricDefinition> = [
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0001", "net_sales.products", "Net sales — products", "currency", "sum", "higher_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0002", "net_sales.services", "Net sales — services", "currency", "sum", "higher_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0003", "net_sales.total", "Total net sales", "currency", "sum", "higher_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0004", "cost_of_sales.products", "Cost of sales — products", "currency", "sum", "lower_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0005", "cost_of_sales.services", "Cost of sales — services", "currency", "sum", "lower_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0006", "cost_of_sales.total", "Total cost of sales", "currency", "sum", "lower_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0007", "gross_profit", "Gross profit", "currency", "sum", "higher_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0008", "operating_expenses.research_and_development", "Research and development", "currency", "sum", "neutral"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0009", "operating_expenses.selling_general_and_administrative", "Selling, general and administrative", "currency", "sum", "lower_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa000a", "operating_expenses.total", "Total operating expenses", "currency", "sum", "lower_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa000b", "operating_income", "Operating income", "currency", "sum", "higher_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa000c", "other_income_net", "Other income / (expense), net", "currency", "sum", "neutral"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa000d", "income_before_taxes", "Income before provision for income taxes", "currency", "sum", "higher_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa000e", "income_tax_expense", "Provision for income taxes", "currency", "sum", "lower_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa000f", "net_income", "Net income", "currency", "sum", "higher_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0010", "eps.basic", "Earnings per share — basic", "currency_per_share", "weighted_average", "higher_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0011", "eps.diluted", "Earnings per share — diluted", "currency_per_share", "weighted_average", "higher_is_better"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0012", "weighted_average_shares.basic", "Weighted-average shares outstanding — basic", "shares", "weighted_average", "neutral"),
  metric("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0013", "weighted_average_shares.diluted", "Weighted-average shares outstanding — diluted", "shares", "weighted_average", "neutral"),
];

export function aaplIncomeMetricRegistry(): MetricRegistry {
  return createMetricRegistry(AAPL_INCOME_METRIC_DEFINITIONS);
}

function metric(
  metric_id: string,
  metric_key: string,
  display_name: string,
  unit_class: MetricDefinition["unit_class"],
  aggregation: MetricDefinition["aggregation"],
  interpretation: MetricDefinition["interpretation"],
): MetricDefinition {
  return {
    metric_id,
    metric_key,
    display_name,
    unit_class,
    aggregation,
    interpretation,
    canonical_source_class: "filing",
    definition_version: 1,
  };
}
