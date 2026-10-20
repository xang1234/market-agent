import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dbRoot, dockerAvailable, run } from "../../../db/test/docker-pg.ts";
import { GOLDEN_ISSUER_IDS } from "../../shared/src/golden-issuers.ts";
import { PolygonFetchError, type PolygonFetcher } from "../src/adapters/polygon.ts";
import { POLYGON_MARKET_SOURCE_ID } from "../src/provider-sources.ts";
import { loadListingSplits, syncListingSplits } from "../src/split-repository.ts";
import { syncSplits } from "../src/split-sync-cli.ts";

const SEC_EDGAR_FILING_SOURCE_ID = "00000000-0000-4000-a000-000000000001";
const ISSUERS = {
  nvda: "36000000-0000-4000-8000-000000000001",
  amd: "36000000-0000-4000-8000-000000000002",
  broken: "36000000-0000-4000-8000-000000000003",
  golden: GOLDEN_ISSUER_IDS.NVDA,
};
const LISTINGS = {
  nvda: "37000000-0000-4000-8000-000000000001",
  nvdaDelisted: "37000000-0000-4000-8000-000000000002",
  amd: "37000000-0000-4000-8000-000000000003",
  broken: "37000000-0000-4000-8000-000000000004",
  golden: "37000000-0000-4000-8000-000000000005",
};

type PolygonRow = { execution_date: string; split_from: number; split_to: number; id: string };

function polygonSplits(byTicker: Record<string, PolygonRow[]>, fetched: string[] = []): PolygonFetcher {
  return async (path) => {
    fetched.push(path);
    const ticker = new URLSearchParams(path.slice(path.indexOf("?"))).get("ticker") ?? "";
    if (!(ticker in byTicker)) throw new PolygonFetchError(404, "polygon: HTTP 404");
    return { status: "OK", results: byTicker[ticker].map((row) => ({ ...row, ticker })) };
  };
}

const at = (iso: string) => () => new Date(iso);

test("listing splits sync and the split sync CLI", { timeout: 180_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for split repository coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "market-listing-splits");
  const seed = run("npm", ["run", "seed", "--", "--database-url", databaseUrl], { cwd: dbRoot, env: { DATABASE_URL: databaseUrl } });
  assert.equal(seed.status, 0, seed.stderr || seed.stdout);
  const db = await connectedPool(t, databaseUrl);
  const listing = async (key: keyof typeof LISTINGS, issuer: keyof typeof ISSUERS, ticker: string, activeTo: string | null = null) => {
    await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2) on conflict do nothing`, [ISSUERS[issuer], `${issuer} corp`]);
    await db.query(
      `insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $2, 'common_stock')`,
      [LISTINGS[key], ISSUERS[issuer]],
    );
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone, active_to)
       values ($1, $1, 'XNAS', $2, 'USD', 'America/New_York', $3)`,
      [LISTINGS[key], ticker, activeTo],
    );
  };
  await listing("nvda", "nvda", "NVDA");
  await listing("nvdaDelisted", "nvda", "NVDQ", "2020-01-01T00:00:00Z");
  await listing("amd", "amd", "AMD");
  await listing("broken", "broken", "BRKN");
  await listing("golden", "golden", "NVDG");
  for (const issuer of [ISSUERS.nvda, ISSUERS.broken, ISSUERS.golden]) {
    await db.query(
      `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                          value_num, unit, currency, scale, as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence)
       select 'issuer', $1, metric_id, 'fiscal_y', '2024-01-29', '2025-01-26', 2025, 'FY', 130497000000, 'currency', 'USD', 1,
              '2025-02-26T00:00:00Z', '2025-02-26T00:00:00Z', $2, 'reported', 'authoritative', 'filing_time', 'full', 1
         from metrics where metric_key = 'revenue'`,
      [issuer, SEC_EDGAR_FILING_SOURCE_ID],
    );
  }
  const nvda = { listing_id: LISTINGS.nvda, ticker: "NVDA" };
  const nvdaFeed = {
    NVDA: [
      { execution_date: "2024-06-10", split_from: 1, split_to: 10, id: "E-2024" },
      { execution_date: "2021-07-20", split_from: 1, split_to: 4, id: "E-2021" },
    ],
  };
  const createdAt = async () => (await db.query(
    `select execution_date::text, created_at from listing_splits where listing_id = $1 order by execution_date`,
    [LISTINGS.nvda],
  )).rows;

  await t.test("a listing never synced reads as unchecked, not as split-free", async () => {
    assert.deepEqual(await loadListingSplits(db, LISTINGS.nvda), { checked_at: null });
  });

  await t.test("a sync records every split and its coverage, and a rerun converges on the same rows", async () => {
    await syncListingSplits(db, polygonSplits(nvdaFeed), nvda, at("2026-10-01T12:00:00.000Z"));
    const expected = {
      checked_at: "2026-10-01T12:00:00.000Z",
      source_id: POLYGON_MARKET_SOURCE_ID,
      splits: [
        { execution_date: "2021-07-20", split_from: 1, split_to: 4, provider_ref: "E-2021" },
        { execution_date: "2024-06-10", split_from: 1, split_to: 10, provider_ref: "E-2024" },
      ],
    };
    assert.deepEqual(await loadListingSplits(db, LISTINGS.nvda), expected);
    const firstRows = await createdAt();

    await syncListingSplits(db, polygonSplits(nvdaFeed), nvda, at("2026-10-02T12:00:00.000Z"));
    assert.deepEqual(await loadListingSplits(db, LISTINGS.nvda), { ...expected, checked_at: "2026-10-02T12:00:00.000Z" });
    assert.deepEqual(await createdAt(), firstRows);
  });

  await t.test("a provider correction replaces the ratio and drops a split it moved or withdrew", async () => {
    const corrected = {
      NVDA: [
        { execution_date: "2024-06-10", split_from: 2, split_to: 15, id: "E-2024-fixed" },
        { execution_date: "2021-07-21", split_from: 1, split_to: 4, id: "E-2021-moved" },
      ],
    };
    await syncListingSplits(db, polygonSplits(corrected), nvda, at("2026-10-03T12:00:00.000Z"));
    assert.deepEqual(await loadListingSplits(db, LISTINGS.nvda), {
      checked_at: "2026-10-03T12:00:00.000Z",
      source_id: POLYGON_MARKET_SOURCE_ID,
      splits: [
        { execution_date: "2021-07-21", split_from: 1, split_to: 4, provider_ref: "E-2021-moved" },
        { execution_date: "2024-06-10", split_from: 2, split_to: 15, provider_ref: "E-2024-fixed" },
      ],
    });
  });

  await t.test("a failed fetch leaves the last complete sync in place", async () => {
    const before = await loadListingSplits(db, LISTINGS.nvda);
    const rateLimited: PolygonFetcher = async () => {
      throw new PolygonFetchError(429, "polygon: HTTP 429");
    };
    await assert.rejects(() => syncListingSplits(db, rateLimited, nvda, at("2026-10-04T12:00:00.000Z")), /polygon: HTTP 429/);
    assert.deepEqual(await loadListingSplits(db, LISTINGS.nvda), before);
  });

  await t.test("a listing checked with no splits reads as checked and split-free", async () => {
    await syncListingSplits(db, polygonSplits({ AMD: [] }), { listing_id: LISTINGS.amd, ticker: "AMD" }, at("2026-10-05T12:00:00.000Z"));
    assert.deepEqual(await loadListingSplits(db, LISTINGS.amd), {
      checked_at: "2026-10-05T12:00:00.000Z",
      source_id: POLYGON_MARKET_SOURCE_ID,
      splits: [],
    });
  });

  await t.test("the CLI syncs active listings with SEC facts, skips the golden dataset, and counts failures", async () => {
    const fetched: string[] = [];
    const lines: string[] = [];
    const log = { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) };
    const fetcher = polygonSplits(nvdaFeed, fetched);

    assert.deepEqual(await syncSplits(db, fetcher, [], log), { failures: 1 });
    assert.deepEqual(fetched, [
      "/v3/reference/splits?ticker=BRKN&limit=1000",
      "/v3/reference/splits?ticker=NVDA&limit=1000",
    ]);
    assert.deepEqual(lines, [
      `BRKN (${LISTINGS.broken}): split sync failed: polygon: HTTP 404`,
      `NVDA (${LISTINGS.nvda}): 2 split(s) recorded`,
      "NVDG: skipped, it is the frozen golden dataset",
    ]);

    fetched.length = 0;
    lines.length = 0;
    const unknown = "37000000-0000-4000-8000-0000000000ff";
    assert.deepEqual(await syncSplits(db, fetcher, [LISTINGS.golden, unknown], log), { failures: 1 });
    assert.deepEqual(fetched, []);
    assert.deepEqual(lines, [`${unknown}: no such listing`, "NVDG: skipped, it is the frozen golden dataset"]);
    assert.deepEqual(await loadListingSplits(db, LISTINGS.golden), { checked_at: null });
  });
});
