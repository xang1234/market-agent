import test from "node:test";
import assert from "node:assert/strict";

import { createPostgresMarketCacheRepository } from "../../market/src/cache-repository.ts";
import { normalizedBars } from "../../market/src/bar.ts";
import { loadPerfComparisonBlocks } from "../src/perf-block.ts";
import { bootstrapDatabase, connectedClient, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { GOLDEN_AS_OF, GOLDEN_COMPANIES, MARKET_SOURCE_ID, seedGoldenDataset } from "./golden/dataset.ts";

const company = (ticker: string) => GOLDEN_COMPANIES.find((candidate) => candidate.ticker === ticker)!;
const NVDA = company("NVDA");
const AMD = company("AMD");
const LISTINGS = [{ id: NVDA.listing_id, label: "NVDA" }, { id: AMD.listing_id, label: "AMD" }];
const LEGACY_RANGE = { start: "2026-08-25T00:00:00.000Z", end: GOLDEN_AS_OF };

test("Polygon ranges cached under the old dividend-adjusted label are never reused, nor rewritten (#191)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for price-basis coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-price-basis");
  const client = await connectedClient(t, databaseUrl);
  await seedGoldenDataset(client);
  // A newer Polygon range per company, stored before #191 as split_and_div_adjusted.
  const legacy: Record<string, string> = {};
  for (const { listing_id } of [NVDA, AMD]) {
    const { rows } = await client.query<{ bar_range_id: string }>(
      `insert into market_bar_ranges
         (listing_id, source_id, provider, interval, adjustment_basis, range_start, range_end,
          as_of, delay_class, currency, fetched_at, expires_at)
       values ($1::uuid, $2::uuid, 'polygon', '1d', 'split_and_div_adjusted', $3::timestamptz, $4::timestamptz,
               $4::timestamptz, 'eod', 'USD', $4::timestamptz, $4::timestamptz + interval '100 years')
       returning bar_range_id::text as bar_range_id`,
      [listing_id, MARKET_SOURCE_ID, LEGACY_RANGE.start, LEGACY_RANGE.end],
    );
    legacy[listing_id] = rows[0]!.bar_range_id;
    await client.query(
      `insert into market_bars (bar_range_id, ts, open, high, low, close, volume)
       values ($1::uuid, '2026-08-25T00:00:00Z', 1, 1, 1, 1, 1), ($1::uuid, '2026-08-26T00:00:00Z', 2, 2, 2, 2, 1)`,
      [legacy[listing_id]],
    );
  }
  const typed = client as unknown as Parameters<typeof loadPerfComparisonBlocks>[0];
  const chart = async () =>
    (await loadPerfComparisonBlocks(typed, { listings: LISTINGS, snapshotId: "64000000-0000-4000-8000-0000000000ce", asOf: GOLDEN_AS_OF }))[0];

  // The chart is drawn from the split-adjusted ranges, never the legacy ones.
  const drawn = await chart();
  assert.equal(drawn?.kind, "perf_comparison");
  assert.equal(drawn.basis, "split_adjusted");
  const used = (drawn.provenance_series_specs as Array<{ bar_range_id: string }>).map((spec) => spec.bar_range_id);
  assert.ok(used.every((id) => !Object.values(legacy).includes(id)), "a legacy range was charted");

  // With only a legacy range left for AMD, there is no chart rather than one built on it.
  await client.query(
    `delete from market_bar_ranges where listing_id = $1::uuid and adjustment_basis = 'split_adjusted'`,
    [AMD.listing_id],
  );
  assert.equal(await chart(), undefined);

  // The cache never serves the legacy range; a refetch under the correct basis is served.
  // A pool: storing bars takes a transaction on its own connection. Closed
  // before the database goes away (connectedPool), or its idle connection
  // reports the shutdown as an uncaught error.
  const pool = await connectedPool(t, databaseUrl);
  const cache = createPostgresMarketCacheRepository(pool);
  const listing = { kind: "listing" as const, id: AMD.listing_id };
  assert.equal(await cache.findLatestBars(listing, "1d", LEGACY_RANGE, "split_and_div_adjusted"), null);
  await cache.storeBars(
    normalizedBars({
      listing,
      interval: "1d",
      range: LEGACY_RANGE,
      bars: [{ ts: "2026-08-25T00:00:00.000Z", open: 3, high: 3, low: 3, close: 3, volume: 1 }],
      as_of: "2026-08-25T00:00:00.000Z",
      delay_class: "eod",
      currency: "USD",
      source_id: MARKET_SOURCE_ID,
      adjustment_basis: "split_adjusted",
    }),
    { provider: "polygon", fetched_at: GOLDEN_AS_OF, expires_at: "2126-01-01T00:00:00.000Z" },
  );
  const refreshed = await cache.findLatestBars(listing, "1d", LEGACY_RANGE, "split_adjusted");
  assert.equal(refreshed?.bars.bars[0].close, 3);

  // The legacy rows are left as they were, so snapshots sealed from them still verify.
  const { rows: kept } = await client.query<{ n: number }>(
    `select count(*)::int as n from market_bars where bar_range_id = any($1::uuid[])`,
    [Object.values(legacy)],
  );
  assert.equal(kept[0]!.n, 4);
});
