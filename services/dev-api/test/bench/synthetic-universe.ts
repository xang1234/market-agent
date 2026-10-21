// A synthetic screener universe on a real PostgreSQL: N single-listing issuers,
// each with a fresh quote, the fiscal-year facts the legacy screener read, and
// the certified inputs a valuation binds (a Polygon close, an as-filed diluted
// EPS, and an as-filed cover count, each with its proofs).

import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { recordFactPrecisionAttestation, recordSourcePublicationAttestation } from "../../../evidence/src/financial-attestations.ts";
import { recordFactFinancialContext } from "../../../evidence/src/financial-context.ts";
import { POLYGON_MARKET_SOURCE_ID } from "../../../market/src/provider-sources.ts";

/** 10:00 on Monday 2024-06-10 in New York: Friday's session is the last one closed. */
export const BENCH_CUTOFF = "2024-06-10T14:00:00.000Z";

const METRICS: ReadonlyArray<readonly [string, string, string]> = [
  ["revenue", "currency", "sum"],
  ["gross_profit", "currency", "sum"],
  ["operating_income", "currency", "sum"],
  ["net_income", "currency", "sum"],
  ["eps_diluted", "currency", "derived"],
  ["weighted_average_diluted_shares", "count", "avg"],
  ["shares_outstanding", "count", "point_in_time"],
];

export type SyntheticListing = Readonly<{ issuer_id: string; listing_id: string; ticker: string }>;

export async function seedBenchBase(db: Client): Promise<void> {
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
     values ($1, 'polygon_market', 'market_data', 'primary', 'licensed', now()) on conflict (source_id) do nothing`,
    [POLYGON_MARKET_SOURCE_ID],
  );
  for (const [key, unitClass, aggregation] of METRICS) {
    await db.query(
      `insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
       values ($1, $1, $2, $3, 'neutral', 'gaap') on conflict (metric_key) do nothing`,
      [key, unitClass, aggregation],
    );
  }
}

/** Seeds `count` listings, numbered from `from`. Listing i closes at 100 + i % 50 with FY diluted EPS 5 and 1,000,000,000 + i shares. */
export async function seedSyntheticListings(db: Client, from: number, count: number): Promise<SyntheticListing[]> {
  const listings: SyntheticListing[] = [];
  for (let i = from; i < from + count; i += 1) {
    const issuer_id = randomUUID();
    const listing_id = randomUUID();
    const ticker = `S${String(i).padStart(5, "0")}`;
    const tenK = randomUUID();
    const tenQ = randomUUID();
    const close = `${100 + (i % 50)}.00`;
    await db.query(
      `insert into issuers (issuer_id, legal_name, domicile, sector, industry) values ($1, $2, 'US', 'Technology', 'Software')`,
      [issuer_id, `Synthetic ${ticker}`],
    );
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [issuer_id]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', $3, 'USD', 'America/New_York')`,
      [listing_id, issuer_id, ticker],
    );
    await db.query(
      `insert into market_quote_snapshots (listing_id, source_id, provider, price, prev_close, session_state, as_of, delay_class, currency, fetched_at, expires_at)
       values ($1, $2, 'polygon', $3, $3, 'regular', now(), 'delayed_15m', 'USD', now(), now() + interval '1 day')`,
      [listing_id, POLYGON_MARKET_SOURCE_ID, close],
    );
    await db.query(`insert into listing_split_coverage (listing_id, checked_at, source_id) values ($1, '2024-06-10T12:00:00Z', $2)`, [listing_id, POLYGON_MARKET_SOURCE_ID]);
    await db.query(
      `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
       values ($1, $2, 'session_close', $3, 'USD', '2024-06-07T20:00:00Z', '2024-06-07T20:15:00Z', '2024-06-07T20:15:00Z', $4)`,
      [listing_id, POLYGON_MARKET_SOURCE_ID, close, "d".repeat(64)],
    );
    for (const [source, publicBy] of [[tenK, "2024-02-21T23:59:59.999-05:00"], [tenQ, "2024-05-29T23:59:59.999-04:00"]] as const) {
      const hash = randomUUID().replaceAll("-", "").padEnd(64, "0");
      await db.query(
        `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash) values ($1, 'sec_edgar', 'filing', 'primary', 'public', '2026-10-01T00:00:00Z', $2)`,
        [source, hash],
      );
      await recordSourcePublicationAttestation(db, {
        source_id: source, document_id: null, source_version_hash: hash, available_not_before: null,
        available_no_later_than: publicBy, timing_precision: "date", source_timezone: "America/New_York",
        proof_method: "accession_bound_archive", proof_ref: `proof:${source}`, proof_hash: "9".repeat(64), mapping_version: "test-accession-archive.v1",
      });
    }
    const fy = { kind: "fiscal_y", start: "2023-01-30", end: "2024-01-28", year: 2024, period: "FY" } as const;
    for (const [metric, value, unit] of [
      ["revenue", "1000000000", "currency"], ["gross_profit", "600000000", "currency"], ["operating_income", "300000000", "currency"],
      ["net_income", "200000000", "currency"], ["weighted_average_diluted_shares", "1000000000", "shares"],
    ] as const) {
      await insertFact(db, { issuer_id, metric, value, unit, source: tenK, reportedAt: "2024-02-21T00:00:00Z", period: fy });
    }
    await insertFact(db, { issuer_id, metric: "revenue", value: "800000000", unit: "currency", source: tenK, reportedAt: "2024-02-21T00:00:00Z", period: { ...fy, start: "2022-01-31", end: "2023-01-29", year: 2023 } });
    await certify(db, await insertFact(db, { issuer_id, metric: "eps_diluted", value: "5.00", unit: "currency_per_share", source: tenK, reportedAt: "2024-02-21T00:00:00Z", period: fy }), {
      value: "5.00", asFiledOn: "2024-02-21", periodType: "duration", shareBasis: "diluted",
    });
    const shares = String(1_000_000_000 + i);
    await certify(db, await insertFact(db, {
      issuer_id, metric: "shares_outstanding", value: shares, unit: "shares", source: tenQ, reportedAt: "2024-05-29T00:00:00Z",
      period: { kind: "point", start: null, end: "2024-05-17", year: 2025, period: "Q1" },
    }), { value: shares, asFiledOn: "2024-05-17", periodType: "instant", shareBasis: "not_applicable" });
    listings.push({ issuer_id, listing_id, ticker });
  }
  return listings;
}

async function insertFact(db: Client, fact: {
  issuer_id: string; metric: string; value: string; unit: string; source: string; reportedAt: string;
  period: { kind: "fiscal_y" | "point"; start: string | null; end: string; year: number; period: string };
}): Promise<string> {
  return (await db.query<{ fact_id: string }>(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                        value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, verification_status,
                        freshness_class, coverage_level, confidence)
     select 'issuer', $1, m.metric_id, $2, $3, $4, $5, $6, $7, $8, $9, 1, '2026-10-01T00:00:00Z', $10, '2026-10-01T00:00:00Z', $11,
            'reported', 'authoritative', 'filing_time', 'full', 1
       from metrics m where m.metric_key = $12
     returning fact_id::text`,
    [fact.issuer_id, fact.period.kind, fact.period.start, fact.period.end, fact.period.year, fact.period.period, fact.value, fact.unit,
      fact.unit === "shares" ? null : "USD", fact.reportedAt, fact.source, fact.metric],
  )).rows[0]!.fact_id;
}

async function certify(db: Client, factId: string, input: { value: string; asFiledOn: string; periodType: "duration" | "instant"; shareBasis: "diluted" | "not_applicable" }): Promise<void> {
  await recordFactPrecisionAttestation(db, {
    fact_id: factId, precision_class: "source_token_preserved", raw_token: input.value, token_proof_hash: "9".repeat(64),
    source_locator: `locator:${factId}`, validation_method: "fixture",
  });
  await recordFactFinancialContext(db, {
    fact_id: factId, context_version: "context.v1", period_type: input.periodType, dimension_scope: "consolidated", dimension_members: [],
    reporting_basis: "as_reported", adjustment_basis: "as_filed", as_filed_on: input.asFiledOn, share_basis: input.shareBasis,
    fiscal_calendar_version: "fiscal-calendar.v1", disclosure_relation: "original", source_context_ref: null,
  });
}
