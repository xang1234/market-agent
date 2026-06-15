import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bootstrapDatabase,
  dbRoot,
  dockerAvailable,
  queryValue,
  run,
} from "./docker-pg.ts";

const METRICS_DIGEST_EXPR =
  "md5(string_agg(metric_key || ':' || display_name || ':' || unit_class || ':' || aggregation || ':' || interpretation || ':' || canonical_source_class, ',' order by metric_key))";
const SOURCES_DIGEST_EXPR =
  "md5(string_agg(source_id::text || ':' || provider || ':' || kind::text || ':' || trust_tier::text || ':' || license_class, ',' order by source_id))";

test("source seed registers GDELT as metadata-only public news discovery", () => {
  const sourcesSql = readFileSync(new URL("../seed/sources.sql", import.meta.url), "utf8");

  assert.match(sourcesSql, /gdelt_article_discovery/);
  assert.match(sourcesSql, /https:\/\/api\.gdeltproject\.org\/api\/v2\/doc\/doc/);
  assert.match(
    sourcesSql,
    /'gdelt_article_discovery',\s*'article',\s*'https:\/\/api\.gdeltproject\.org\/api\/v2\/doc\/doc',\s*'tertiary',\s*'ephemeral'/,
  );
});

test("source seed registers open reference and Stooq market sources", () => {
  const sourcesSql = readFileSync(new URL("../seed/sources.sql", import.meta.url), "utf8");

  for (const provider of [
    "openfigi_reference",
    "gleif_reference",
    "nasdaq_trader_reference",
    "stooq_market",
  ]) {
    assert.match(sourcesSql, new RegExp(`'${provider}'`), `${provider} must be seeded`);
  }

  assert.match(
    sourcesSql,
    /'openfigi_reference',\s*'reference_data',\s*'https:\/\/api\.openfigi\.com\/v3\/mapping',\s*'secondary',\s*'free'/,
  );
  assert.match(
    sourcesSql,
    /'gleif_reference',\s*'reference_data',\s*'https:\/\/api\.gleif\.org\/api\/v1\/lei-records',\s*'primary',\s*'public'/,
  );
  assert.match(
    sourcesSql,
    /'nasdaq_trader_reference',\s*'reference_data',\s*'https:\/\/www\.nasdaqtrader\.com\/dynamic\/symdir\/nasdaqlisted\.txt',\s*'primary',\s*'public'/,
  );
  assert.match(
    sourcesSql,
    /'stooq_market',\s*'market_data',\s*'https:\/\/stooq\.com\/q\/d\/l\/',\s*'tertiary',\s*'free'/,
  );
});

test("source seed registers the stock-screener artifact ETL sources", () => {
  const sourcesSql = readFileSync(new URL("../seed/sources.sql", import.meta.url), "utf8");

  // Weekly reference fundamentals bundle (reference_data) and daily price bundle
  // (market_data), both under the xang1234/stock-screener provider.
  assert.match(
    sourcesSql,
    /'xang1234_stock_screener',\s*'reference_data',\s*'https:\/\/github\.com\/xang1234\/stock-screener\/releases\/download\/weekly-reference-data',\s*'tertiary',\s*'free'/,
  );
  assert.match(
    sourcesSql,
    /'xang1234_stock_screener',\s*'market_data',\s*'https:\/\/github\.com\/xang1234\/stock-screener\/releases\/download\/daily-price-data',\s*'tertiary',\s*'free'/,
  );
});

type SeedSnapshot = {
  metricCount: string;
  sourceCount: string;
  devIssuerCount: string;
  devInstrumentCount: string;
  devListingCount: string;
  mockUserCount: string;
  mockDefaultWatchlistCount: string;
  metricsDigest: string;
  sourcesDigest: string;
  devListingsDigest: string | null;
};

function snapshotSeed(containerName: string): SeedSnapshot {
  // -tAc uses '|' as the default column separator, giving the same
  // pipe-delimited row without an explicit concat.
  const row = queryValue(
    containerName,
    `select
       (select count(*) from metrics),
       (select count(*) from sources),
       (select count(*) from issuers where issuer_id in (${DEV_ISSUER_IDS.map((id) => `'${id}'::uuid`).join(",")})),
       (select count(*) from instruments where instrument_id in (${DEV_INSTRUMENT_IDS.map((id) => `'${id}'::uuid`).join(",")})),
       (select count(*) from listings where listing_id in (${DEV_LISTING_IDS.map((id) => `'${id}'::uuid`).join(",")})),
       (select count(*) from users where user_id = '${DEV_MOCK_USER_ID}'::uuid),
       (select count(*) from watchlists where user_id = '${DEV_MOCK_USER_ID}'::uuid and mode = 'manual' and is_default),
       (select ${METRICS_DIGEST_EXPR} from metrics),
       (select ${SOURCES_DIGEST_EXPR} from sources),
       (select md5(string_agg(l.ticker || ':' || l.mic || ':' || l.listing_id::text || ':' || i.instrument_id::text || ':' || iss.issuer_id::text, ',' order by l.ticker))
          from listings l
          join instruments i on i.instrument_id = l.instrument_id
          join issuers iss on iss.issuer_id = i.issuer_id
         where l.listing_id in (${DEV_LISTING_IDS.map((id) => `'${id}'::uuid`).join(",")}))`,
  );
  const [
    metricCount,
    sourceCount,
    devIssuerCount,
    devInstrumentCount,
    devListingCount,
    mockUserCount,
    mockDefaultWatchlistCount,
    metricsDigest,
    sourcesDigest,
    devListingsDigest,
  ] = row.split("|");
  return {
    metricCount,
    sourceCount,
    devIssuerCount,
    devInstrumentCount,
    devListingCount,
    mockUserCount,
    mockDefaultWatchlistCount,
    metricsDigest,
    sourcesDigest,
    devListingsDigest,
  };
}

function runSeed(databaseUrl: string) {
  return run("npm", ["run", "seed", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
}

const DEV_MOCK_USER_ID = "00000000-0000-4000-8000-000000000001";

const DEV_ISSUER_IDS = [
  "11111111-1111-4111-9111-111111111111",
  "22222222-2222-4222-9222-222222222222",
  "33333333-3333-4333-9333-333333333333",
  "44444444-4444-4444-9444-444444444444",
  "55555555-5555-4555-9555-555555555555",
];

const DEV_INSTRUMENT_IDS = [
  "11111111-1111-4111-b111-111111111111",
  "22222222-2222-4222-b222-222222222222",
  "33333333-3333-4333-b333-333333333333",
  "44444444-4444-4444-b444-444444444444",
  "55555555-5555-4555-b555-555555555555",
];

const DEV_LISTING_IDS = [
  "11111111-1111-4111-a111-111111111111",
  "22222222-2222-4222-a222-222222222222",
  "33333333-3333-4333-a333-333333333333",
  "44444444-4444-4444-a444-444444444444",
  "55555555-5555-4555-a555-555555555555",
];

test("seed populates metrics and sources with the expected registry", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db seed integration coverage");
    return;
  }

  const { containerName, databaseUrl } = await bootstrapDatabase(t, "fra-6al-7-3");

  const seedResult = runSeed(databaseUrl);
  assert.equal(seedResult.status, 0, seedResult.stderr || seedResult.stdout);

  const { metricCount, sourceCount } = snapshotSeed(containerName);
  assert.equal(Number(metricCount) > 0, true, "expected metrics to be populated");
  assert.equal(Number(sourceCount) > 0, true, "expected sources to be populated");

  for (const coreMetric of ["revenue", "net_income", "eps_diluted", "gross_margin", "pe_ratio"]) {
    assert.equal(
      queryValue(containerName, `select count(*) from metrics where metric_key = '${coreMetric}'`),
      "1",
      `expected core metric ${coreMetric} to be present exactly once`,
    );
  }

  for (const ifrsMetric of ["ifrs.revenue", "ifrs.profit_loss", "ifrs.eps_diluted"]) {
    assert.equal(
      queryValue(
        containerName,
        `select count(*) from metrics where metric_key = '${ifrsMetric}' and canonical_source_class = 'ifrs'`,
      ),
      "1",
      `expected IFRS metric ${ifrsMetric} to be present exactly once`,
    );
  }

  assert.equal(
    queryValue(containerName, "select count(*) from sources where provider = 'sec_edgar' and kind = 'filing'"),
    "1",
    "expected sec_edgar filing source to be present exactly once",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from sources where provider = 'yahoo_finance_dev_reference' and kind = 'reference_data'"),
    "1",
    "expected yahoo_finance_dev_reference source to be present exactly once",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from sources where provider = 'yahoo_finance_dev_market' and kind = 'market_data'"),
    "1",
    "expected yahoo_finance_dev_market source to be present exactly once",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from sources where provider = 'finviz_dev_reference' and kind = 'reference_data'"),
    "1",
    "expected finviz_dev_reference source to be present exactly once",
  );
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from sources where provider = 'gdelt_article_discovery' and kind = 'article' and trust_tier = 'tertiary' and license_class = 'ephemeral'",
    ),
    "1",
    "expected gdelt_article_discovery metadata-only article source to be present exactly once",
  );

  for (const [provider, kind] of [
    ["openfigi_reference", "reference_data"],
    ["gleif_reference", "reference_data"],
    ["nasdaq_trader_reference", "reference_data"],
    ["stooq_market", "market_data"],
  ] as const) {
    assert.equal(
      queryValue(containerName, `select count(*) from sources where provider = '${provider}' and kind = '${kind}'`),
      "1",
      `expected ${provider} ${kind} source to be present exactly once`,
    );
  }
});

test("seed is idempotent: re-running produces no duplicates", { timeout: 180000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db seed integration coverage");
    return;
  }

  const { containerName, databaseUrl } = await bootstrapDatabase(t, "fra-6al-7-3");

  const first = runSeed(databaseUrl);
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const before = snapshotSeed(containerName);

  const second = runSeed(databaseUrl);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  assert.deepEqual(snapshotSeed(containerName), before);
});

test("seeded metric and source rows satisfy referential contracts for facts", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db seed integration coverage");
    return;
  }

  const { containerName, databaseUrl } = await bootstrapDatabase(t, "fra-6al-7-3");

  const seedResult = runSeed(databaseUrl);
  assert.equal(seedResult.status, 0, seedResult.stderr || seedResult.stdout);

  const insertFact = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `insert into facts (
       subject_kind, subject_id, metric_id, period_kind, observed_at, as_of,
       unit, confidence, source_id, method, definition_version,
       verification_status, freshness_class, coverage_level
     )
     select
       'issuer'::subject_kind,
       gen_random_uuid(),
       m.metric_id,
       'fiscal_q',
       now(),
       now(),
       'USD',
       0.9,
       s.source_id,
       'reported'::fact_method,
       1,
       'authoritative'::verification_status,
       'filing_time'::freshness_class,
       'full'::coverage_level
     from metrics m
     cross join sources s
     where m.metric_key = 'revenue' and s.provider = 'sec_edgar' and s.kind = 'filing';`,
  ]);
  assert.equal(insertFact.status, 0, insertFact.stderr || insertFact.stdout);
  assert.equal(queryValue(containerName, "select count(*) from facts"), "1");
});

test("seed provisions the mock user and default manual watchlist", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db seed integration coverage");
    return;
  }

  const { containerName, databaseUrl } = await bootstrapDatabase(t, "fra-jmu");

  const seedResult = runSeed(databaseUrl);
  assert.equal(seedResult.status, 0, seedResult.stderr || seedResult.stdout);

  assert.equal(
    queryValue(containerName, `select count(*) from users where user_id = '${DEV_MOCK_USER_ID}'::uuid`),
    "1",
    "expected the dev mock user to be present",
  );
  assert.equal(
    queryValue(
      containerName,
      `select count(*)
         from watchlists
        where user_id = '${DEV_MOCK_USER_ID}'::uuid
          and mode = 'manual'
          and is_default`,
    ),
    "1",
    "expected the users_default_manual_watchlist trigger to create the default manual watchlist",
  );
});

test("seed does not provision provider-owned ticker identities", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db seed integration coverage");
    return;
  }

  const { containerName, databaseUrl } = await bootstrapDatabase(t, "fra-q4d");

  const seedResult = runSeed(databaseUrl);
  assert.equal(seedResult.status, 0, seedResult.stderr || seedResult.stdout);

  const aaplLookupRows = queryValue(
    containerName,
    `select count(*)
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = i.issuer_id
      where l.ticker = 'AAPL'
        and l.mic = 'XNAS'
        and l.listing_id = '11111111-1111-4111-a111-111111111111'::uuid
        and i.instrument_id = '11111111-1111-4111-b111-111111111111'::uuid
        and iss.issuer_id = '11111111-1111-4111-9111-111111111111'::uuid`,
  );
  assert.equal(
    aaplLookupRows,
    "0",
    "normal seed data must not create hardcoded AAPL listing -> instrument -> issuer rows",
  );

  const snapshot = snapshotSeed(containerName);
  assert.equal(snapshot.devIssuerCount, "0");
  assert.equal(snapshot.devInstrumentCount, "0");
  assert.equal(snapshot.devListingCount, "0");
  assert.equal(snapshot.devListingsDigest, "");
});
