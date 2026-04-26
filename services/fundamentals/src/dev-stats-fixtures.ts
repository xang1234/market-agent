// Hand-authored MappedStatement fixtures for dev/test. Real production
// path will read these from a statements service that runs the full
// extractStatement → normalizedStatement → mapStatement pipeline. The
// metric_id UUIDs here are stable but synthetic — they don't need to
// match any seeded metric registry to satisfy buildKeyStats.

import type { MappedStatement, MappedStatementLine } from "./metric-mapper.ts";
import type { MarketPriceInput } from "./key-stats.ts";
import type { StatsRepositoryRecord } from "./stats-repository.ts";
import type { IssuerSubjectRef, UUID } from "./subject-ref.ts";

export const DEV_STATEMENT_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000003";
export const DEV_PRICE_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000004";

// Stable synthetic metric_ids per canonical metric_key, so a fixture line
// keyed on "revenue" always carries the same metric_id across fixtures.
const METRIC_ID: Readonly<Record<string, UUID>> = {
  revenue: "11111111-1111-4111-9111-111111111111",
  cost_of_revenue: "22222222-2222-4222-9222-222222222222",
  gross_profit: "33333333-3333-4333-9333-333333333333",
  operating_expenses: "44444444-4444-4444-9444-444444444444",
  operating_income: "55555555-5555-4555-9555-555555555555",
  net_income: "66666666-6666-4666-9666-666666666666",
  eps_basic: "77777777-7777-4777-9777-777777777777",
  eps_diluted: "88888888-8888-4888-9888-888888888888",
};

const APPLE_ISSUER: IssuerSubjectRef = {
  kind: "issuer",
  id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1",
};

const NVDA_ISSUER: IssuerSubjectRef = {
  kind: "issuer",
  id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa5",
};

function moneyLine(metric_key: string, value_num: number, currency = "USD"): MappedStatementLine {
  return {
    metric_key,
    metric_id: METRIC_ID[metric_key],
    value_num,
    unit: "currency",
    scale: 1,
    coverage_level: "full",
    currency,
  };
}

function epsLine(metric_key: string, value_num: number, currency = "USD"): MappedStatementLine {
  return {
    metric_key,
    metric_id: METRIC_ID[metric_key],
    value_num,
    unit: "currency_per_share",
    scale: 1,
    coverage_level: "full",
    currency,
  };
}

const APPLE_FY2024_STATEMENT: MappedStatement = {
  subject: APPLE_ISSUER,
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
  source_id: DEV_STATEMENT_SOURCE_ID,
  lines: [
    moneyLine("revenue", 391_035_000_000),
    moneyLine("cost_of_revenue", 210_352_000_000),
    moneyLine("gross_profit", 180_683_000_000),
    moneyLine("operating_expenses", 57_467_000_000),
    moneyLine("operating_income", 123_216_000_000),
    moneyLine("net_income", 93_736_000_000),
    epsLine("eps_basic", 6.11),
    epsLine("eps_diluted", 6.08),
  ],
};

const APPLE_FY2023_STATEMENT: MappedStatement = {
  subject: APPLE_ISSUER,
  family: "income",
  basis: "as_reported",
  period_kind: "fiscal_y",
  period_start: "2022-10-02",
  period_end: "2023-09-30",
  fiscal_year: 2023,
  fiscal_period: "FY",
  reporting_currency: "USD",
  as_of: "2023-11-03T20:30:00.000Z",
  reported_at: "2023-11-03T20:30:00.000Z",
  source_id: DEV_STATEMENT_SOURCE_ID,
  lines: [
    moneyLine("revenue", 383_285_000_000),
    moneyLine("cost_of_revenue", 214_137_000_000),
    moneyLine("gross_profit", 169_148_000_000),
    moneyLine("operating_expenses", 54_847_000_000),
    moneyLine("operating_income", 114_301_000_000),
    moneyLine("net_income", 96_995_000_000),
    epsLine("eps_basic", 6.16),
    epsLine("eps_diluted", 6.13),
  ],
};

const APPLE_PRICE: MarketPriceInput = {
  subject: APPLE_ISSUER,
  fact_id: "ffffffff-ffff-4fff-afff-ffffffffff01",
  value_num: 196.58,
  currency: "USD",
  as_of: "2026-04-26T15:30:00.000Z",
  source_id: DEV_PRICE_SOURCE_ID,
};

// Sparse case: an issuer with only a current statement — no prior, no
// price. buildKeyStats should still return the envelope; revenue_growth
// and pe_ratio will carry "missing_*" warnings rather than fabricated
// values. Used by the integration test that proves warnings flow through.
const NVDA_FY2024_STATEMENT: MappedStatement = {
  subject: NVDA_ISSUER,
  family: "income",
  basis: "as_reported",
  period_kind: "fiscal_y",
  period_start: "2023-01-30",
  period_end: "2024-01-28",
  fiscal_year: 2024,
  fiscal_period: "FY",
  reporting_currency: "USD",
  as_of: "2024-02-21T21:00:00.000Z",
  reported_at: "2024-02-21T21:00:00.000Z",
  source_id: DEV_STATEMENT_SOURCE_ID,
  lines: [
    moneyLine("revenue", 60_922_000_000),
    moneyLine("gross_profit", 44_301_000_000),
    moneyLine("operating_income", 32_972_000_000),
    moneyLine("net_income", 29_760_000_000),
  ],
};

export const DEV_STATS_INPUTS: ReadonlyArray<StatsRepositoryRecord> = [
  {
    subject_id: APPLE_ISSUER.id,
    inputs: {
      statement: APPLE_FY2024_STATEMENT,
      prior_statement: APPLE_FY2023_STATEMENT,
      price: APPLE_PRICE,
    },
  },
  {
    subject_id: NVDA_ISSUER.id,
    inputs: {
      statement: NVDA_FY2024_STATEMENT,
    },
  },
];
