// Frozen research dataset for the golden chat conversation (#118).
//
// Three issuers (NVDA, AMD, AAPL) with identity, eight fiscal quarters and two
// fiscal years of income-statement facts, a cached quote, and a short run of
// daily bars. Facts are written through the evidence repo's createFact — the
// same validation path live ingestion uses — so the golden test exercises real
// provenance, not a bypass. Values are approximate, illustrative figures for tests and offline
// development; they are not a data source.
//
// NVDA also has business-segment revenue for its latest quarter (#157): each
// segment is a `segments` row and its revenue a fact whose subject is that
// segment, so a segment drill-down cites real facts. AMD and AAPL have none, so
// asking for theirs exercises the honest "not available" answer.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Client } from "pg";

import { createClaimArgument } from "../../../evidence/src/claim-argument-repo.ts";
import { createClaimEvidence } from "../../../evidence/src/claim-evidence-repo.ts";
import { createClaim } from "../../../evidence/src/claim-repo.ts";
import { createDocument } from "../../../evidence/src/document-repo.ts";
import { createFact } from "../../../evidence/src/fact-repo.ts";
import { recordFactPrecisionAttestation, recordSourcePublicationAttestation } from "../../../evidence/src/financial-attestations.ts";
import { recordFactFinancialContext } from "../../../evidence/src/financial-context.ts";
import { ephemeralRawBlobIdForSource } from "../../../evidence/src/object-store.ts";
import { createSource } from "../../../evidence/src/source-repo.ts";
import { FROZEN_AS_OF } from "../../src/ytd-hydration.ts";
import { GOLDEN_ISSUER_IDS } from "../../../shared/src/golden-issuers.ts";
import { SEC_EDGAR_FILING_SOURCE_ID } from "../../../fundamentals/src/provider-sources.ts";

const SEED_DIR = join(import.meta.dirname, "..", "..", "..", "..", "db", "seed");

// Fixed ids from db/seed/sources.sql.
export const MARKET_SOURCE_ID = "00000000-0000-4000-a000-000000000009";

export const GOLDEN_SOURCE_ID = "65000000-0000-4000-8000-000000000001";

// The frozen modes answer at this cutoff (src/ytd-hydration.ts, #259).
export const GOLDEN_AS_OF = FROZEN_AS_OF;

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
  // Business-segment revenue for one quarter, USD millions, summing to that
  // quarter's revenue.
  segments?: Readonly<{
    fiscal_year: number;
    fiscal_period: Quarter["fiscal_period"];
    revenue: ReadonlyArray<readonly [string, number]>;
  }>;
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
    issuer_id: GOLDEN_ISSUER_IDS.NVDA,
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
    segments: {
      fiscal_year: 2026,
      fiscal_period: "Q4",
      revenue: [
        ["Data Center", 55200],
        ["Gaming", 4300],
        ["Professional Visualization", 900],
        ["Automotive", 650],
        ["OEM & Other", 1050],
      ],
    },
  },
  {
    ticker: "AMD",
    legal_name: "Advanced Micro Devices, Inc.",
    cik: "0000002488",
    sector: "Technology",
    industry: "Semiconductors",
    issuer_id: GOLDEN_ISSUER_IDS.AMD,
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
    issuer_id: GOLDEN_ISSUER_IDS.AAPL,
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

type GoldenIssuerFact = Readonly<{
  key: string;
  issuer_id: string;
  metric_key: (typeof INCOME_METRICS)[number];
  period_kind: "fiscal_q" | "fiscal_y";
  period_start: string;
  period_end: string;
  fiscal_year: number;
  fiscal_period: Quarter["fiscal_period"] | "FY";
  value_usd: number;
}>;

const GOLDEN_ISSUER_FACTS: ReadonlyArray<GoldenIssuerFact> = Object.freeze(
  GOLDEN_COMPANIES.flatMap((company) => {
    const periods = [
      ...company.quarters.map((quarter) => ({
        ...quarter,
        period_kind: "fiscal_q" as const,
        values: INCOME_METRICS.map((metricKey) => quarter[metricKey]),
      })),
      ...company.years.map(([fiscal_year, period_start, period_end, ...values]) => ({
        fiscal_year,
        fiscal_period: "FY" as const,
        period_start,
        period_end,
        period_kind: "fiscal_y" as const,
        values: values.map((value) => value * 1e6),
      })),
    ];
    return periods.flatMap(({ period_kind, period_start, period_end, fiscal_year, fiscal_period, values }) =>
      INCOME_METRICS.map((metric_key, index) => ({
        key: `${company.ticker}.${fiscal_year}.${fiscal_period}.${metric_key}`,
        issuer_id: company.issuer_id,
        metric_key,
        period_kind,
        period_start,
        period_end,
        fiscal_year,
        fiscal_period,
        value_usd: values[index]!,
      })),
    );
  }),
);
for (const fact of GOLDEN_ISSUER_FACTS) {
  if (!Number.isSafeInteger(fact.value_usd)) throw new Error(`golden dataset: ${fact.key} is not a whole number of USD, so its decimal text is not exact`);
}

export function goldenFixtureVersion(asOf: string): string {
  return createHash("sha256").update(JSON.stringify({ GOLDEN_AS_OF: asOf, GOLDEN_COMPANIES })).digest("hex");
}
const GOLDEN_SOURCE_VERSION = goldenFixtureVersion(GOLDEN_AS_OF);

// Daily bars from early December, so a year-to-date window has its baseline
// (the last 2025 close) and runs to the session before GOLDEN_AS_OF (#192).
const BARS_FROM = "2025-12-01";

// AMD's own explanation of its Q2 2025 margin drop (#282): two sentences quoted
// verbatim from its earnings release, filed with the SEC as exhibit 99.1 to a
// Form 8-K dated August 5, 2025, so a "why" question has a cause in evidence.
// The other margin moves (NVDA's Q1 FY2026 gross margin) keep none, so "the
// data does not show why" stays the honest answer there.
export const AMD_Q2_2025_RELEASE = {
  url: "https://www.sec.gov/Archives/edgar/data/2488/000000248825000106/q22025991.htm",
  title: "AMD Reports Second Quarter 2025 Financial Results (Form 8-K, Exhibit 99.1)",
  // The release's dateline; the hour is not stated, so the date is used.
  published_at: "2025-08-05T00:00:00.000Z",
  // The quarter the claim is about: AMD's fiscal Q2 2025, ended 2025-06-28.
  effective_time: "2025-06-28T00:00:00.000Z",
  text: "As previously announced, our second quarter results were impacted by the U.S. Government's export control on our AMD Instinct MI308 data center GPU products. For the quarter, these restrictions led to approximately $800 million in inventory and related charges.",
} as const;

export async function seedGoldenDataset(client: Client): Promise<void> {
  // The dev seeds provide the metrics registry and the fixed source rows.
  for (const file of ["metrics.sql", "sources.sql"]) {
    await client.query(await readFile(join(SEED_DIR, file), "utf8"));
  }
  const metricIds = await loadMetricIds(client);
  await insertGoldenSource(client);

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

    for (const fact of GOLDEN_ISSUER_FACTS.filter((fact) => fact.issuer_id === company.issuer_id)) {
      await createFact(client, {
        subject_kind: "issuer",
        subject_id: company.issuer_id,
        metric_id: metricIds.get(fact.metric_key)!,
        period_kind: fact.period_kind,
        period_start: fact.period_start,
        period_end: fact.period_end,
        fiscal_year: fact.fiscal_year,
        fiscal_period: fact.fiscal_period,
        value_num: fact.value_usd,
        unit: "currency",
        currency: "USD",
        as_of: GOLDEN_AS_OF,
        reported_at: GOLDEN_AS_OF,
        observed_at: GOLDEN_AS_OF,
        source_id: GOLDEN_SOURCE_ID,
        method: "reported",
        verification_status: "authoritative",
        freshness_class: "filing_time",
        coverage_level: "full",
        entitlement_channels: ["app"],
        confidence: 1,
      });
    }

    await seedSegments(client, company, metricIds.get("revenue")!);
    await seedQuote(client, company);
    await seedDailyBars(client, company);
  }
  await seedGoldenProofs(client);
  await seedFiledClaims(client);
}

export class GoldenFactMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenFactMismatchError";
  }
}

async function insertGoldenSource(client: Client): Promise<void> {
  await client.query(
    `insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at, content_hash)
     values ($1::uuid, 'golden_fixture', 'filing', null, 'primary', 'internal', $2::timestamptz, $3)
     on conflict (source_id) do nothing`,
    [GOLDEN_SOURCE_ID, GOLDEN_AS_OF, `sha256:${GOLDEN_SOURCE_VERSION}`],
  );
}

export async function seedGoldenProofs(client: Client): Promise<void> {
  const { rows: proofs } = await client.query<{ source_version_hash: string }>(
    `select source_version_hash from current_source_publication_attestations where source_id = $1::uuid`,
    [GOLDEN_SOURCE_ID],
  );
  if (proofs.some((proof) => proof.source_version_hash === GOLDEN_SOURCE_VERSION)) return;
  if (proofs.length > 0) {
    throw new GoldenFactMismatchError(`golden dataset: this database holds an earlier version of the dataset (${proofs[0]!.source_version_hash})`);
  }
  await insertGoldenSource(client);

  for (const fact of GOLDEN_ISSUER_FACTS) {
    const { rows } = await client.query<{ fact_id: string }>(
      `update facts f set source_id = $1::uuid
         from metrics m
        where m.metric_id = f.metric_id and m.metric_key = $2
          and f.subject_kind = 'issuer' and f.subject_id = $3::uuid and f.period_kind = $4
          and f.fiscal_year = $5 and f.fiscal_period = $6 and f.value_num = $7::numeric
          and f.period_start = $10::date and f.period_end = $11::date
          and f.scale = 1 and f.unit = 'currency' and f.currency = 'USD' and f.method = 'reported'
          and f.as_of = $8::timestamptz and f.observed_at = $8::timestamptz
          and f.source_id in ($1::uuid, $9::uuid)
       returning f.fact_id::text as fact_id`,
      [
        GOLDEN_SOURCE_ID, fact.metric_key, fact.issuer_id, fact.period_kind, fact.fiscal_year, fact.fiscal_period, fact.value_usd,
        GOLDEN_AS_OF, SEC_EDGAR_FILING_SOURCE_ID, fact.period_start, fact.period_end,
      ],
    );
    if (rows.length !== 1) throw new GoldenFactMismatchError(`golden dataset: expected one stored fact for ${fact.key}, found ${rows.length}`);
    const locator = `golden_fixture:dataset.ts#${fact.key}`;
    const rawToken = String(fact.value_usd);
    await recordFactPrecisionAttestation(client, {
      fact_id: rows[0]!.fact_id,
      precision_class: "source_token_preserved",
      raw_token: rawToken,
      token_proof_hash: createHash("sha256").update(`${locator}=${rawToken}`).digest("hex"),
      source_locator: locator,
      validation_method: "golden_fixture_declared_token.v1",
    });
    await recordFactFinancialContext(client, {
      fact_id: rows[0]!.fact_id,
      context_version: "golden_fixture_context.v1",
      period_type: "duration",
      dimension_scope: "consolidated",
      dimension_members: [],
      reporting_basis: "as_reported",
      adjustment_basis: "unadjusted",
      share_basis: "not_applicable",
      fiscal_calendar_version: "golden_fixture_fiscal_year.v1",
      disclosure_relation: "original",
      source_context_ref: locator,
    });
  }

  for (const company of GOLDEN_COMPANIES) {
    if (!company.segments) continue;
    const { fiscal_year, fiscal_period, revenue } = company.segments;
    const quarter = company.quarters.find((q) => q.fiscal_year === fiscal_year && q.fiscal_period === fiscal_period)!;
    for (const [name, value] of revenue) {
      const { rows } = await client.query(
        `update facts f set source_id = $1::uuid
           from segments s, metrics m
          where s.segment_id = f.subject_id and m.metric_id = f.metric_id and m.metric_key = 'revenue'
            and f.subject_kind = 'segment' and s.issuer_id = $2::uuid and s.axis = 'business' and s.name = $3
            and s.definition_as_of = $4::timestamptz
            and f.period_kind = 'fiscal_q' and f.fiscal_year = $5 and f.fiscal_period = $6
            and f.period_start = $7::date and f.period_end = $8::date and f.value_num = $9::numeric
            and f.scale = 1 and f.unit = 'currency' and f.currency = 'USD' and f.method = 'reported'
            and f.as_of = $4::timestamptz and f.observed_at = $4::timestamptz
            and f.source_id in ($1::uuid, $10::uuid)
          returning f.fact_id`,
        [
          GOLDEN_SOURCE_ID, company.issuer_id, name, GOLDEN_AS_OF, fiscal_year, fiscal_period,
          quarter.period_start, quarter.period_end, value * 1e6, SEC_EDGAR_FILING_SOURCE_ID,
        ],
      );
      const key = `${company.ticker}.${fiscal_year}.${fiscal_period}.revenue.${name}`;
      if (rows.length !== 1) throw new GoldenFactMismatchError(`golden dataset: expected one stored fact for ${key}, found ${rows.length}`);
    }
  }

  await recordSourcePublicationAttestation(client, {
    source_id: GOLDEN_SOURCE_ID,
    document_id: null,
    source_version_hash: GOLDEN_SOURCE_VERSION,
    available_not_before: null,
    available_no_later_than: GOLDEN_AS_OF,
    timing_precision: "instant",
    source_timezone: "UTC",
    proof_method: "fixture_declaration",
    proof_ref: "golden_fixture:dataset.ts",
    proof_hash: GOLDEN_SOURCE_VERSION,
    mapping_version: "golden-fixture-declaration.v1",
  });
}

// The filed claim, through the same repositories live ingestion uses. Once:
// a database that already holds the release's source is left as it is, so a
// dev database seeded before #282 can be backfilled (seed-golden-dev.ts).
export async function seedFiledClaims(client: Client): Promise<void> {
  const amd = GOLDEN_COMPANIES.find((company) => company.ticker === "AMD")!;
  const release = AMD_Q2_2025_RELEASE;
  const { rowCount } = await client.query(`select 1 from sources where canonical_url = $1`, [release.url]);
  if (rowCount) return;
  const source = await createSource(client, {
    provider: "sec_edgar",
    kind: "press_release",
    canonical_url: release.url,
    trust_tier: "primary",
    license_class: "public",
    retrieved_at: GOLDEN_AS_OF,
    content_hash: `sha256:${"a".repeat(64)}`,
  });
  const document = (await createDocument(client, {
    source_id: source.source_id,
    kind: "press_release",
    title: release.title,
    published_at: release.published_at,
    content_hash: `sha256:${"b".repeat(64)}`,
    raw_blob_id: ephemeralRawBlobIdForSource(source.source_id),
    parse_status: "parsed",
  })).document;
  const claim = await createClaim(client, {
    document_id: document.document_id,
    predicate: "kpi.commentary",
    text_canonical: release.text,
    polarity: "negative",
    modality: "asserted",
    reported_by_source_id: source.source_id,
    effective_time: release.effective_time,
    confidence: 0.95,
    status: "extracted",
  });
  // Known by the golden cutoff, as the seeded facts are: a turn reads only
  // claims ingested by its cutoff.
  await client.query(`update claims set created_at = $2, updated_at = $2 where claim_id = $1::uuid`, [claim.claim_id, GOLDEN_AS_OF]);
  await createClaimArgument(client, { claim_id: claim.claim_id, subject_kind: "issuer", subject_id: amd.issuer_id, role: "subject" });
  await createClaimEvidence(client, { claim_id: claim.claim_id, document_id: document.document_id, locator: { kind: "paragraph", index: 2 }, confidence: 0.95 });
}

async function seedSegments(client: Client, company: GoldenCompany, revenueMetricId: string): Promise<void> {
  if (!company.segments) return;
  const { fiscal_year, fiscal_period, revenue } = company.segments;
  const quarter = company.quarters.find((q) => q.fiscal_year === fiscal_year && q.fiscal_period === fiscal_period)!;
  for (const [name, value] of revenue) {
    const { rows } = await client.query<{ segment_id: string }>(
      `insert into segments (issuer_id, axis, name, definition_as_of)
       values ($1::uuid, 'business', $2, $3::timestamptz)
       returning segment_id::text as segment_id`,
      [company.issuer_id, name, GOLDEN_AS_OF],
    );
    await createFact(client, {
      subject_kind: "segment",
      subject_id: rows[0]!.segment_id,
      metric_id: revenueMetricId,
      period_kind: "fiscal_q",
      period_start: quarter.period_start,
      period_end: quarter.period_end,
      fiscal_year,
      fiscal_period,
      value_num: value * 1e6,
      unit: "currency",
      currency: "USD",
      as_of: GOLDEN_AS_OF,
      reported_at: GOLDEN_AS_OF,
      observed_at: GOLDEN_AS_OF,
      source_id: GOLDEN_SOURCE_ID,
      method: "reported",
      verification_status: "authoritative",
      freshness_class: "filing_time",
      coverage_level: "full",
      entitlement_channels: ["app"],
      confidence: 1,
    });
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

// A deterministic walk from 95% of prev_close up to the quote price, one close
// per weekday session; enough for a performance chart, not a market-data source.
// Stored as Polygon stores daily bars: split-adjusted only (#191), each stamped
// at the start of its New York session date.
async function seedDailyBars(client: Client, company: GoldenCompany): Promise<void> {
  const sessions = weekdaysBefore(BARS_FROM, GOLDEN_AS_OF);
  const { rows } = await client.query<{ bar_range_id: string }>(
    `insert into market_bar_ranges
       (listing_id, source_id, provider, interval, adjustment_basis, range_start, range_end,
        as_of, delay_class, currency, fetched_at, expires_at)
     values ($1::uuid, $2::uuid, 'golden_fixture', '1d', 'split_adjusted', $3::timestamptz,
             $4::timestamptz, $4::timestamptz, 'eod', 'USD', $4::timestamptz,
             $4::timestamptz + interval '100 years')
     returning bar_range_id::text as bar_range_id`,
    [company.listing_id, MARKET_SOURCE_ID, sessions[0], GOLDEN_AS_OF],
  );
  const { price, prev_close } = company.quote;
  const closes = sessions.map((_, day) => prev_close * 0.95 + ((price - prev_close * 0.95) * (day + 1)) / sessions.length);
  await client.query(
    `insert into market_bars (bar_range_id, ts, open, high, low, close, volume)
     select $1::uuid, ts, close * 0.995, close * 1.01, close * 0.99, close, 1000000 + n * 10000
       from unnest($2::timestamptz[], $3::float8[]) with ordinality as bar(ts, close, n)`,
    [rows[0]!.bar_range_id, sessions, closes],
  );
}

// New York local midnight of each weekday from `from` until the session of
// `before`, as UTC instants (EDT from 2026-03-08 to 2026-11-01, EST otherwise).
function weekdaysBefore(from: string, before: string): string[] {
  const out: string[] = [];
  for (let day = new Date(`${from}T00:00:00.000Z`); ; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    const hour = date >= "2026-03-08" && date < "2026-11-01" ? "04" : "05";
    const ts = `${date}T${hour}:00:00.000Z`;
    if (ts >= before) return out;
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) out.push(ts);
  }
}
