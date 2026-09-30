// Frozen research dataset for the golden chat conversation (#118).
//
// Three issuers (NVDA, AMD, AAPL) with identity, eight fiscal quarters and two
// fiscal years of income-statement facts, a cached quote, and a short run of
// daily bars. Facts are written through the evidence repo's createFact — the
// same validation path live ingestion uses — so the golden test exercises real
// provenance, not a bypass. Values are approximate, illustrative figures for tests and offline
// development; they are not a data source.
//
// ponytail: NVDA segment facts are not seeded. The default chat path has no
// DB-backed segment store (segments come from providers / dev fixtures); add
// them with the segment drill-down step.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Client } from "pg";

import { createFact } from "../../../evidence/src/fact-repo.ts";

const SEED_DIR = join(import.meta.dirname, "..", "..", "..", "..", "db", "seed");

// Fixed ids from db/seed/sources.sql.
export const SEC_FILING_SOURCE_ID = "00000000-0000-4000-a000-000000000001";
export const MARKET_SOURCE_ID = "00000000-0000-4000-a000-000000000009";

export const GOLDEN_AS_OF = "2026-09-01T00:00:00.000Z";

type Quarter = {
  fiscal_year: number;
  fiscal_period: "Q1" | "Q2" | "Q3" | "Q4";
  period_start: string;
  period_end: string;
  revenue: number;
  gross_profit: number;
  operating_income: number;
  net_income: number;
};

export type GoldenCompany = {
  ticker: string;
  legal_name: string;
  cik: string;
  // Peers are companies in the same industry (fundamentals peer-set resolver).
  sector: string;
  industry: string;
  issuer_id: string;
  instrument_id: string;
  listing_id: string;
  quote: { price: number; prev_close: number };
  quarters: ReadonlyArray<Quarter>;
  // Two fiscal years of annual statements, for the comparison's margins and
  // year-over-year growth: [fiscal_year, start, end, revenue, gross_profit,
  // operating_income, net_income] in USD millions.
  years: ReadonlyArray<readonly [number, string, string, number, number, number, number]>;
};

// USD millions, oldest first.
function quarters(
  rows: ReadonlyArray<[number, Quarter["fiscal_period"], string, string, number, number, number, number]>,
): Quarter[] {
  return rows.map(([fiscal_year, fiscal_period, period_start, period_end, revenue, gross_profit, operating_income, net_income]) => ({
    fiscal_year,
    fiscal_period,
    period_start,
    period_end,
    revenue: revenue * 1e6,
    gross_profit: gross_profit * 1e6,
    operating_income: operating_income * 1e6,
    net_income: net_income * 1e6,
  }));
}

export const GOLDEN_COMPANIES: ReadonlyArray<GoldenCompany> = Object.freeze([
  {
    ticker: "NVDA",
    legal_name: "NVIDIA Corporation",
    cik: "0001045810",
    sector: "Technology",
    industry: "Semiconductors",
    issuer_id: "60000000-0000-4000-8000-000000000001",
    instrument_id: "61000000-0000-4000-8000-000000000001",
    listing_id: "62000000-0000-4000-8000-000000000001",
    quote: { price: 178.4, prev_close: 176.1 },
    quarters: quarters([
      [2025, "Q1", "2024-01-29", "2024-04-28", 26044, 20406, 16909, 14881],
      [2025, "Q2", "2024-04-29", "2024-07-28", 30040, 22574, 18642, 16599],
      [2025, "Q3", "2024-07-29", "2024-10-27", 35082, 26156, 21869, 19309],
      [2025, "Q4", "2024-10-28", "2025-01-26", 39331, 28723, 24034, 22091],
      [2026, "Q1", "2025-01-27", "2025-04-27", 44062, 26668, 21638, 18775],
      [2026, "Q2", "2025-04-28", "2025-07-27", 46743, 33853, 28440, 26422],
      [2026, "Q3", "2025-07-28", "2025-10-26", 57006, 41849, 36010, 31910],
      [2026, "Q4", "2025-10-27", "2026-01-25", 62100, 46200, 40300, 35400],
    ]),
    years: [
      [2025, "2024-01-29", "2025-01-26", 130497, 97859, 81454, 72880],
      [2026, "2025-01-27", "2026-01-25", 209911, 148570, 126388, 112507],
    ],
  },
  {
    ticker: "AMD",
    legal_name: "Advanced Micro Devices, Inc.",
    cik: "0000002488",
    sector: "Technology",
    industry: "Semiconductors",
    issuer_id: "60000000-0000-4000-8000-000000000002",
    instrument_id: "61000000-0000-4000-8000-000000000002",
    listing_id: "62000000-0000-4000-8000-000000000002",
    quote: { price: 162.3, prev_close: 164.9 },
    quarters: quarters([
      [2024, "Q3", "2024-06-30", "2024-09-28", 6819, 3419, 724, 771],
      [2024, "Q4", "2024-09-29", "2024-12-28", 7658, 3903, 871, 482],
      [2025, "Q1", "2024-12-29", "2025-03-29", 7438, 3735, 806, 709],
      [2025, "Q2", "2025-03-30", "2025-06-28", 7685, 3059, -134, 872],
      [2025, "Q3", "2025-06-29", "2025-09-27", 9246, 4953, 1270, 1243],
      [2025, "Q4", "2025-09-28", "2025-12-27", 10300, 5560, 1450, 1350],
      [2026, "Q1", "2025-12-28", "2026-03-28", 10700, 5780, 1520, 1400],
      [2026, "Q2", "2026-03-29", "2026-06-27", 11200, 6050, 1610, 1480],
    ]),
    years: [
      [2024, "2023-12-31", "2024-12-28", 25785, 12725, 401, 1641],
      [2025, "2024-12-29", "2025-12-27", 34669, 17307, 3392, 4174],
    ],
  },
  {
    ticker: "AAPL",
    legal_name: "Apple Inc.",
    cik: "0000320193",
    sector: "Technology",
    industry: "Consumer Electronics",
    issuer_id: "60000000-0000-4000-8000-000000000003",
    instrument_id: "61000000-0000-4000-8000-000000000003",
    listing_id: "62000000-0000-4000-8000-000000000003",
    quote: { price: 231.6, prev_close: 229.8 },
    quarters: quarters([
      [2024, "Q4", "2024-06-30", "2024-09-28", 94930, 43879, 29591, 14736],
      [2025, "Q1", "2024-09-29", "2024-12-28", 124300, 58275, 42832, 36330],
      [2025, "Q2", "2024-12-29", "2025-03-29", 95359, 44867, 29589, 24780],
      [2025, "Q3", "2025-03-30", "2025-06-28", 94036, 43718, 28202, 23434],
      [2025, "Q4", "2025-06-29", "2025-09-27", 102466, 48341, 32427, 27466],
      [2026, "Q1", "2025-09-28", "2025-12-27", 128000, 60200, 44100, 37500],
      [2026, "Q2", "2025-12-28", "2026-03-28", 98700, 46600, 30900, 25900],
      [2026, "Q3", "2026-03-29", "2026-06-27", 97100, 45700, 29800, 24900],
    ]),
    years: [
      [2024, "2023-10-01", "2024-09-28", 391035, 180683, 123216, 93736],
      [2025, "2024-09-29", "2025-09-27", 416161, 195201, 133050, 112010],
    ],
  },
]);

const INCOME_METRICS = ["revenue", "gross_profit", "operating_income", "net_income"] as const;
const BAR_DAYS = 10;

export async function seedGoldenDataset(client: Client): Promise<void> {
  // The dev seeds provide the metrics registry and the fixed source rows.
  for (const file of ["metrics.sql", "sources.sql"]) {
    await client.query(await readFile(join(SEED_DIR, file), "utf8"));
  }
  const metricIds = await loadMetricIds(client);

  for (const company of GOLDEN_COMPANIES) {
    await client.query(
      `insert into issuers (issuer_id, legal_name, cik, sector, industry) values ($1::uuid, $2, $3, $4, $5)`,
      [company.issuer_id, company.legal_name, company.cik, company.sector, company.industry],
    );
    await client.query(
      `insert into instruments (instrument_id, issuer_id, asset_type, share_class)
       values ($1::uuid, $2::uuid, 'common_stock', 'common')`,
      [company.instrument_id, company.issuer_id],
    );
    await client.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
       values ($1::uuid, $2::uuid, 'XNAS', $3, 'USD', 'America/New_York')`,
      [company.listing_id, company.instrument_id, company.ticker],
    );

    for (const quarter of company.quarters) {
      for (const metricKey of INCOME_METRICS) {
        await createFact(client, {
          subject_kind: "issuer",
          subject_id: company.issuer_id,
          metric_id: metricIds.get(metricKey)!,
          period_kind: "fiscal_q",
          period_start: quarter.period_start,
          period_end: quarter.period_end,
          fiscal_year: quarter.fiscal_year,
          fiscal_period: quarter.fiscal_period,
          value_num: quarter[metricKey],
          unit: "currency",
          currency: "USD",
          as_of: GOLDEN_AS_OF,
          reported_at: GOLDEN_AS_OF,
          observed_at: GOLDEN_AS_OF,
          source_id: SEC_FILING_SOURCE_ID,
          method: "reported",
          verification_status: "authoritative",
          freshness_class: "filing_time",
          coverage_level: "full",
          entitlement_channels: ["app"],
          confidence: 1,
        });
      }
    }

    for (const [fiscal_year, period_start, period_end, ...values] of company.years) {
      for (const [index, metricKey] of INCOME_METRICS.entries()) {
        await createFact(client, {
          subject_kind: "issuer",
          subject_id: company.issuer_id,
          metric_id: metricIds.get(metricKey)!,
          period_kind: "fiscal_y",
          period_start,
          period_end,
          fiscal_year,
          fiscal_period: "FY",
          value_num: values[index] * 1e6,
          unit: "currency",
          currency: "USD",
          as_of: GOLDEN_AS_OF,
          reported_at: GOLDEN_AS_OF,
          observed_at: GOLDEN_AS_OF,
          source_id: SEC_FILING_SOURCE_ID,
          method: "reported",
          verification_status: "authoritative",
          freshness_class: "filing_time",
          coverage_level: "full",
          entitlement_channels: ["app"],
          confidence: 1,
        });
      }
    }

    await seedQuote(client, company);
    await seedDailyBars(client, company);
  }
}

async function loadMetricIds(client: Client): Promise<Map<string, string>> {
  const { rows } = await client.query<{ metric_key: string; metric_id: string }>(
    `select metric_key, metric_id::text as metric_id from metrics where metric_key = any($1::text[])`,
    [INCOME_METRICS],
  );
  const ids = new Map(rows.map((row) => [row.metric_key, row.metric_id]));
  for (const key of INCOME_METRICS) {
    if (!ids.has(key)) throw new Error(`golden dataset: metric '${key}' missing from db/seed/metrics.sql`);
  }
  return ids;
}

async function seedQuote(client: Client, company: GoldenCompany): Promise<void> {
  await client.query(
    `insert into market_quote_snapshots
       (listing_id, source_id, provider, price, prev_close, session_state, as_of,
        delay_class, currency, fetched_at, expires_at)
     values ($1::uuid, $2::uuid, 'golden_fixture', $3, $4, 'closed', $5::timestamptz,
             'eod', 'USD', $5::timestamptz, $5::timestamptz + interval '100 years')`,
    [company.listing_id, MARKET_SOURCE_ID, company.quote.price, company.quote.prev_close, GOLDEN_AS_OF],
  );
}

// A deterministic walk back from prev_close to the quote price over BAR_DAYS
// sessions; enough for a performance chart, not a market-data source.
async function seedDailyBars(client: Client, company: GoldenCompany): Promise<void> {
  const end = new Date(GOLDEN_AS_OF);
  const start = new Date(end.getTime() - BAR_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await client.query<{ bar_range_id: string }>(
    `insert into market_bar_ranges
       (listing_id, source_id, provider, interval, adjustment_basis, range_start, range_end,
        as_of, delay_class, currency, fetched_at, expires_at)
     values ($1::uuid, $2::uuid, 'golden_fixture', '1d', 'split_and_div_adjusted', $3::timestamptz,
             $4::timestamptz, $4::timestamptz, 'eod', 'USD', $4::timestamptz,
             $4::timestamptz + interval '100 years')
     returning bar_range_id::text as bar_range_id`,
    [company.listing_id, MARKET_SOURCE_ID, start.toISOString(), end.toISOString()],
  );
  const barRangeId = rows[0]!.bar_range_id;
  const { price, prev_close } = company.quote;
  for (let day = 0; day < BAR_DAYS; day += 1) {
    const close = prev_close * 0.95 + ((price - prev_close * 0.95) * (day + 1)) / BAR_DAYS;
    const ts = new Date(start.getTime() + day * 24 * 60 * 60 * 1000);
    await client.query(
      `insert into market_bars (bar_range_id, ts, open, high, low, close, volume)
       values ($1::uuid, $2::timestamptz, $3, $4, $5, $6, $7)`,
      [barRangeId, ts.toISOString(), close * 0.995, close * 1.01, close * 0.99, close, 1_000_000 + day * 10_000],
    );
  }
}
