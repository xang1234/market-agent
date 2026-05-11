import { DEV_ISSUER_PROFILES } from "./dev-fixtures.ts";
import type {
  NormalizedStatementInput,
  StatementLine,
} from "./statement.ts";
import type { StatementRepositoryRecord } from "./statement-repository.ts";
import type { UUID } from "./subject-ref.ts";

export const DEV_STATEMENT_FIXTURE_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000005";

const APPLE_ISSUER = DEV_ISSUER_PROFILES[0].subject;

function moneyLine(metric_key: string, value_num: number, currency = "USD"): StatementLine {
  return {
    metric_key,
    value_num,
    unit: "currency",
    currency,
    scale: 1,
    coverage_level: "full",
  };
}

function epsLine(metric_key: string, value_num: number, currency = "USD"): StatementLine {
  return {
    metric_key,
    value_num,
    unit: "currency_per_share",
    currency,
    scale: 1,
    coverage_level: "full",
  };
}

type PeriodLines = {
  fiscal_year: number;
  fiscal_period: "FY" | "Q1" | "Q2" | "Q3" | "Q4";
  period_kind: "fiscal_y" | "fiscal_q";
  period_start: string;
  period_end: string;
  reported_at: string;
  revenue: number;
  cost_of_revenue: number;
  gross_profit: number;
  operating_expenses: number;
  operating_income: number;
  net_income: number;
  eps_basic: number;
  eps_diluted: number;
};

function appleIncomeStatement(p: PeriodLines): NormalizedStatementInput {
  return {
    subject: APPLE_ISSUER,
    family: "income",
    basis: "as_reported",
    period_kind: p.period_kind,
    period_start: p.period_start,
    period_end: p.period_end,
    fiscal_year: p.fiscal_year,
    fiscal_period: p.fiscal_period,
    reporting_currency: "USD",
    as_of: `${p.reported_at}T20:30:00.000Z`,
    reported_at: `${p.reported_at}T20:30:00.000Z`,
    source_id: DEV_STATEMENT_FIXTURE_SOURCE_ID,
    lines: [
      moneyLine("revenue", p.revenue),
      moneyLine("cost_of_revenue", p.cost_of_revenue),
      moneyLine("gross_profit", p.gross_profit),
      moneyLine("operating_expenses", p.operating_expenses),
      moneyLine("operating_income", p.operating_income),
      moneyLine("net_income", p.net_income),
      epsLine("eps_basic", p.eps_basic),
      epsLine("eps_diluted", p.eps_diluted),
    ],
  };
}

const APPLE_INCOME_PERIODS: ReadonlyArray<PeriodLines> = [
  {
    fiscal_year: 2020,
    fiscal_period: "FY",
    period_kind: "fiscal_y",
    period_start: "2019-09-29",
    period_end: "2020-09-26",
    reported_at: "2020-10-30",
    revenue: 274_515_000_000,
    cost_of_revenue: 169_559_000_000,
    gross_profit: 104_956_000_000,
    operating_expenses: 38_668_000_000,
    operating_income: 66_288_000_000,
    net_income: 57_411_000_000,
    eps_basic: 3.31,
    eps_diluted: 3.28,
  },
  {
    fiscal_year: 2021,
    fiscal_period: "FY",
    period_kind: "fiscal_y",
    period_start: "2020-09-27",
    period_end: "2021-09-25",
    reported_at: "2021-10-29",
    revenue: 365_817_000_000,
    cost_of_revenue: 212_981_000_000,
    gross_profit: 152_836_000_000,
    operating_expenses: 43_887_000_000,
    operating_income: 108_949_000_000,
    net_income: 94_680_000_000,
    eps_basic: 5.67,
    eps_diluted: 5.61,
  },
  {
    fiscal_year: 2022,
    fiscal_period: "FY",
    period_kind: "fiscal_y",
    period_start: "2021-09-26",
    period_end: "2022-09-24",
    reported_at: "2022-10-28",
    revenue: 394_328_000_000,
    cost_of_revenue: 223_546_000_000,
    gross_profit: 170_782_000_000,
    operating_expenses: 51_345_000_000,
    operating_income: 119_437_000_000,
    net_income: 99_803_000_000,
    eps_basic: 6.15,
    eps_diluted: 6.11,
  },
  {
    fiscal_year: 2023,
    fiscal_period: "FY",
    period_kind: "fiscal_y",
    period_start: "2022-10-02",
    period_end: "2023-09-30",
    reported_at: "2023-11-03",
    revenue: 383_285_000_000,
    cost_of_revenue: 214_137_000_000,
    gross_profit: 169_148_000_000,
    operating_expenses: 54_847_000_000,
    operating_income: 114_301_000_000,
    net_income: 96_995_000_000,
    eps_basic: 6.16,
    eps_diluted: 6.13,
  },
  {
    fiscal_year: 2024,
    fiscal_period: "FY",
    period_kind: "fiscal_y",
    period_start: "2023-10-01",
    period_end: "2024-09-28",
    reported_at: "2024-11-01",
    revenue: 391_035_000_000,
    cost_of_revenue: 210_352_000_000,
    gross_profit: 180_683_000_000,
    operating_expenses: 57_467_000_000,
    operating_income: 123_216_000_000,
    net_income: 93_736_000_000,
    eps_basic: 6.11,
    eps_diluted: 6.08,
  },
];

const APPLE_INCOME_QUARTERS_FY2024: ReadonlyArray<PeriodLines> = [
  {
    fiscal_year: 2024,
    fiscal_period: "Q1",
    period_kind: "fiscal_q",
    period_start: "2023-10-01",
    period_end: "2023-12-30",
    reported_at: "2024-02-02",
    revenue: 119_575_000_000,
    cost_of_revenue: 64_720_000_000,
    gross_profit: 54_855_000_000,
    operating_expenses: 14_482_000_000,
    operating_income: 40_373_000_000,
    net_income: 33_916_000_000,
    eps_basic: 2.19,
    eps_diluted: 2.18,
  },
  {
    fiscal_year: 2024,
    fiscal_period: "Q2",
    period_kind: "fiscal_q",
    period_start: "2023-12-31",
    period_end: "2024-03-30",
    reported_at: "2024-05-03",
    revenue: 90_753_000_000,
    cost_of_revenue: 48_482_000_000,
    gross_profit: 42_271_000_000,
    operating_expenses: 14_371_000_000,
    operating_income: 27_900_000_000,
    net_income: 23_636_000_000,
    eps_basic: 1.53,
    eps_diluted: 1.53,
  },
  {
    fiscal_year: 2024,
    fiscal_period: "Q3",
    period_kind: "fiscal_q",
    period_start: "2024-03-31",
    period_end: "2024-06-29",
    reported_at: "2024-08-02",
    revenue: 85_777_000_000,
    cost_of_revenue: 46_099_000_000,
    gross_profit: 39_678_000_000,
    operating_expenses: 14_326_000_000,
    operating_income: 25_352_000_000,
    net_income: 21_448_000_000,
    eps_basic: 1.40,
    eps_diluted: 1.40,
  },
  {
    fiscal_year: 2024,
    fiscal_period: "Q4",
    period_kind: "fiscal_q",
    period_start: "2024-06-30",
    period_end: "2024-09-28",
    reported_at: "2024-11-01",
    revenue: 94_930_000_000,
    cost_of_revenue: 51_051_000_000,
    gross_profit: 43_879_000_000,
    operating_expenses: 14_288_000_000,
    operating_income: 29_591_000_000,
    net_income: 14_736_000_000,
    eps_basic: 0.98,
    eps_diluted: 0.97,
  },
];

// One restated period to exercise the basis branch. FY2020 was later
// restated for an immaterial reclassification — the values diverge from
// as_reported by enough to be detectable without picking real 10-K/A
// figures. The exact numbers are illustrative; the contract being tested
// is "as_reported and as_restated are returned independently."
const APPLE_INCOME_FY2020_RESTATED: NormalizedStatementInput = {
  ...appleIncomeStatement(APPLE_INCOME_PERIODS[0]),
  basis: "as_restated",
  as_of: "2021-10-29T20:30:00.000Z",
  reported_at: "2021-10-29T20:30:00.000Z",
  lines: [
    moneyLine("revenue", 274_515_000_000),
    moneyLine("cost_of_revenue", 169_559_000_000),
    moneyLine("gross_profit", 104_956_000_000),
    moneyLine("operating_expenses", 38_668_000_000),
    moneyLine("operating_income", 66_288_000_000),
    moneyLine("net_income", 57_411_000_000),
    epsLine("eps_basic", 3.30),
    epsLine("eps_diluted", 3.27),
  ],
};

export const DEV_STATEMENTS: ReadonlyArray<StatementRepositoryRecord> = [
  ...APPLE_INCOME_PERIODS.map((p) => ({
    issuer_id: APPLE_ISSUER.id,
    basis: "as_reported" as const,
    statement: appleIncomeStatement(p),
  })),
  ...APPLE_INCOME_QUARTERS_FY2024.map((p) => ({
    issuer_id: APPLE_ISSUER.id,
    basis: "as_reported" as const,
    statement: appleIncomeStatement(p),
  })),
  {
    issuer_id: APPLE_ISSUER.id,
    basis: "as_restated" as const,
    statement: APPLE_INCOME_FY2020_RESTATED,
  },
];
