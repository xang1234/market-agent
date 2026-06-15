import test from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapDatabase,
  connectedClient,
  dbRoot,
  dockerAvailable,
  run,
} from "../../../db/test/docker-pg.ts";
import { runWeeklyReferenceEtl } from "../src/etl.ts";
import { loadVendorScreenerCandidates } from "../../screener/src/db-candidates-vendor.ts";
import type { WeeklyReferenceBundle, WeeklyReferenceManifest } from "../src/types.ts";

function runSeed(databaseUrl: string) {
  return run("npm", ["run", "seed", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
}

const MANIFEST: WeeklyReferenceManifest = {
  schema_version: "weekly-reference-manifest-v1",
  market: "US",
  as_of_date: "2026-06-03",
  bundle_asset_name: "weekly-reference-us-20260603-fundamentals_v1_us-20260603063002.json.gz",
  sha256: "test-sha-abc123",
  generated_at: "2026-06-03T10:18:57Z",
};

const BUNDLE: WeeklyReferenceBundle = {
  schema_version: "weekly-reference-bundle-v1",
  market: "US",
  as_of_date: "2026-06-03",
  snapshot: {
    rows: [
      {
        symbol: "TSTA",
        exchange: "NYSE",
        normalized_payload: {
          country: "USA",
          market_cap_usd: 1_000_000,
          forward_pe: 20.5,
          rsi_14: 70.1,
          perf_year: 12.3,
          sales_growth_yy: 50, // percent points upstream → fraction at the screener
          gross_margin: null, // 0%-covered field — must not produce a fact
        },
      },
      {
        symbol: "TSTB",
        exchange: "NASDAQ",
        normalized_payload: { country: "USA", market_cap_usd: 500, rsi_14: 41.2 },
      },
    ],
  },
  universe: [
    {
      symbol: "TSTA",
      name: "Test Alpha Inc",
      exchange: "XNYS",
      currency: "USD",
      timezone: "America/New_York",
      sector: "Technology",
      industry: "Software - Infrastructure",
      market: "US",
      is_active: true,
    },
    {
      symbol: "TSTB",
      name: "Test Beta Corp",
      exchange: "XNAS",
      currency: "USD",
      timezone: "America/New_York",
      sector: "Healthcare",
      industry: "Biotechnology",
      market: "US",
      is_active: true,
    },
    {
      symbol: "TSTC",
      name: "Test Gamma Ltd",
      exchange: "MYSTERY_EXCHANGE", // unmappable MIC → skipped + counted
      currency: "USD",
      timezone: "America/New_York",
      sector: "Energy",
      industry: "Oil & Gas",
      market: "US",
      is_active: true,
    },
  ],
};

const FIXED_CLOCK = () => new Date("2026-06-14T12:00:00Z");

test("weekly-reference ETL seeds the universe, mints vendor facts, and is idempotent", { timeout: 180000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for screener-artifacts ETL integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-screener-artifacts");
  const seedResult = runSeed(databaseUrl);
  assert.equal(seedResult.status, 0, seedResult.stderr || seedResult.stdout);
  const client = await connectedClient(t, databaseUrl);

  const report = await runWeeklyReferenceEtl(client, MANIFEST, BUNDLE, { clock: FIXED_CLOCK });

  // TSTA + TSTB seed; TSTC's unmappable exchange is skipped + counted.
  assert.equal(report.status, "ingested");
  assert.equal(report.rowsTotal, 3);
  assert.equal(report.rowsIngested, 2);
  assert.equal(report.rowsSkipped, 1);
  // TSTA: market_cap, forward_pe_ratio, rsi_14, perf_year, revenue_growth_yoy (5);
  // TSTB: market_cap, rsi_14 (2).
  assert.equal(report.factsWritten, 7);
  assert.equal(report.errorSamples.length, 0);

  // Identity chain seeded with the universe MIC + issuer profile filled.
  const listings = await client.query(
    `select l.ticker, l.mic, iss.sector, iss.industry, iss.domicile
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = i.issuer_id
      where l.ticker in ('TSTA', 'TSTB', 'TSTC')
      order by l.ticker`,
  );
  assert.deepEqual(listings.rows.map((r) => r.ticker), ["TSTA", "TSTB"]);
  assert.equal(listings.rows[0].mic, "XNYS");
  assert.equal(listings.rows[0].sector, "Technology");
  assert.equal(listings.rows[0].industry, "Software - Infrastructure");
  assert.equal(listings.rows[0].domicile, "US");

  // Vendor facts carry honest provenance: method='vendor', the run's batch id, the
  // seeded source. gross_margin (null upstream) produced no fact.
  const facts = await client.query<{
    ticker: string;
    metric_key: string;
    value_num: string;
    method: string;
    ingestion_batch_id: string;
    source_id: string;
  }>(
    `select l.ticker, m.metric_key, f.value_num, f.method,
            f.ingestion_batch_id::text as ingestion_batch_id, f.source_id::text as source_id
       from facts f
       join metrics m on m.metric_id = f.metric_id
       join instruments i on i.issuer_id = f.subject_id
       join listings l on l.instrument_id = i.instrument_id
      where f.subject_kind = 'issuer' and l.ticker in ('TSTA', 'TSTB')
      order by l.ticker, m.metric_key`,
  );
  assert.equal(facts.rows.length, 7);
  assert.ok(facts.rows.every((r) => r.method === "vendor"), "all facts are method='vendor'");
  assert.ok(
    facts.rows.every((r) => r.ingestion_batch_id === report.ingestionBatchId),
    "all facts carry the run's ingestion_batch_id",
  );
  const tstaMarketCap = facts.rows.find((r) => r.ticker === "TSTA" && r.metric_key === "market_cap");
  assert.equal(Number(tstaMarketCap?.value_num), 1_000_000);
  // The fact is stored as percent (its registry unit); only the screener candidate
  // above sees the fraction — the conversion lives at the read boundary.
  const tstaRevGrowth = facts.rows.find((r) => r.ticker === "TSTA" && r.metric_key === "revenue_growth_yoy");
  assert.equal(Number(tstaRevGrowth?.value_num), 50);
  assert.equal(
    facts.rows.some((r) => r.metric_key === "gross_margin"),
    false,
    "null upstream fields produce no facts",
  );

  // Provenance enrichments: sector/industry/domicile per seeded issuer.
  const enrichments = await client.query(
    `select count(*)::int as n
       from issuer_profile_enrichments
      where provider = 'xang1234_stock_screener'`,
  );
  assert.equal(enrichments.rows[0].n, 6);

  // Ledger records the run (partial: TSTC skipped).
  const ledger = await client.query(
    `select status, rows_total, rows_ingested, rows_skipped, sha256
       from artifact_ingestion_ledger where market = 'US'`,
  );
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0].status, "partial");
  assert.equal(Number(ledger.rows[0].rows_ingested), 2);
  assert.equal(ledger.rows[0].sha256, "test-sha-abc123");

  // End-to-end: the vendor candidate repository surfaces the ingested universe,
  // fundamentals-first (no daily quote ingested), with technicals populated and the
  // 0%-covered margin/PE fields null.
  const candidates = await loadVendorScreenerCandidates(client, FIXED_CLOCK());
  const tsta = candidates.find((c) => c.display.ticker === "TSTA");
  assert.ok(tsta, "TSTA present in vendor candidates");
  assert.equal(tsta.subject_ref.kind, "listing");
  assert.equal(tsta.universe.sector, "Technology");
  assert.equal(tsta.universe.mic, "XNYS");
  assert.equal(tsta.fundamentals.market_cap, 1_000_000);
  assert.equal(tsta.fundamentals.forward_pe, 20.5);
  assert.equal(tsta.fundamentals.rsi_14, 70.1);
  assert.equal(tsta.fundamentals.perf_year, 12.3);
  // 50% (percent fact) is converted to a fraction at the screener boundary.
  assert.equal(tsta.fundamentals.revenue_growth_yoy, 0.5);
  assert.equal(tsta.fundamentals.pe_ratio, null);
  assert.equal(tsta.fundamentals.gross_margin, null);
  assert.equal(tsta.quote.last_price, null);
  assert.equal(tsta.quote.delay_class, "unknown");
  assert.equal(tsta.quote.currency, "USD");
  assert.equal(candidates.some((c) => c.display.ticker === "TSTC"), false);

  // Idempotent re-run: the sha256 gate skips, no new facts.
  const factCountBefore = (await client.query<{ n: number }>("select count(*)::int as n from facts")).rows[0].n;
  const rerun = await runWeeklyReferenceEtl(client, MANIFEST, BUNDLE, { clock: FIXED_CLOCK });
  assert.equal(rerun.status, "skipped");
  const factCountAfter = (await client.query<{ n: number }>("select count(*)::int as n from facts")).rows[0].n;
  assert.equal(factCountAfter, factCountBefore);

  // --force bypasses the gate and re-ingests (newest-wins reader bounds correctness).
  const forced = await runWeeklyReferenceEtl(client, MANIFEST, BUNDLE, { clock: FIXED_CLOCK, force: true });
  assert.equal(forced.status, "ingested");
});
