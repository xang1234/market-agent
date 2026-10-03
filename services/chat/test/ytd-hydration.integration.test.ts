import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import type { BarsRequest, MarketDataAdapter } from "../../market/src/adapter.ts";
import { available, unavailable } from "../../market/src/availability.ts";
import { normalizedBars } from "../../market/src/bar.ts";
import { createPostgresMarketCacheRepository } from "../../market/src/cache-repository.ts";
import { createCachedMarketDataAdapter } from "../../market/src/cached-adapter.ts";
import { createMarketServer } from "../../market/src/http.ts";
import { createPostgresListingRepository } from "../../market/src/listings.ts";
import { zonedDateStartUtcIso } from "../../market/src/range-canonicalization.ts";
import { ytdYear } from "../../market/src/ytd-window.ts";
import { loadPerfComparisonBlocks } from "../src/perf-block.ts";
import { hydrateYtdBars } from "../src/ytd-hydration.ts";
import { bootstrapDatabase, connectedPool, dockerAvailable, registerLifoCleanup } from "../../../db/test/docker-pg.ts";
import { GOLDEN_AS_OF, GOLDEN_COMPANIES, MARKET_SOURCE_ID, seedGoldenDataset } from "./golden/dataset.ts";

const company = (ticker: string) => GOLDEN_COMPANIES.find((candidate) => candidate.ticker === ticker)!;
const LISTINGS = [
  { id: company("NVDA").listing_id, label: "NVDA" },
  { id: company("AMD").listing_id, label: "AMD" },
];
const NY = "America/New_York";

// A provider with split-adjusted weekday closes: 100 (NVDA) or 50 (AMD) before
// the current year, 20% higher in it (times `scale`). Counts its calls.
function fakeProvider(yearStart: string, scale = 1) {
  let calls = 0;
  const adapter: MarketDataAdapter = {
    providerName: "polygon",
    sourceId: MARKET_SOURCE_ID,
    async getQuote(request) {
      return unavailable({ reason: "missing_coverage", listing: request.listing, source_id: MARKET_SOURCE_ID, as_of: GOLDEN_AS_OF, retryable: false });
    },
    async getBars(request: BarsRequest) {
      calls += 1;
      const base = (request.listing.id === LISTINGS[0].id ? 100 : 50) * scale;
      const bars = [];
      for (let day = new Date(request.range.start); day.getTime() < Date.parse(request.range.end); day.setUTCDate(day.getUTCDate() + 1)) {
        const ts = zonedDateStartUtcIso(day.toISOString().slice(0, 10), NY);
        if (Date.parse(ts) < Date.parse(request.range.start) || Date.parse(ts) >= Date.parse(request.range.end)) continue;
        if (new Date(ts).getUTCDay() === 0 || new Date(ts).getUTCDay() === 6) continue;
        const close = ts < yearStart ? base : base * 1.2;
        bars.push({ ts, open: close, high: close, low: close, close, volume: 1 });
      }
      return available(normalizedBars({
        listing: request.listing,
        interval: request.interval,
        range: request.range,
        bars,
        as_of: bars.at(-1)!.ts,
        delay_class: "eod",
        currency: "USD",
        source_id: MARKET_SOURCE_ID,
        adjustment_basis: "split_adjusted",
      }));
    },
  };
  return { adapter, calls: () => calls };
}

test("a live YTD request with an empty cache fetches, stores, and seals the window; a repeat reuses the cache (#232)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for YTD hydration coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-ytd-hydration");
  const pool = await connectedPool(t, databaseUrl);
  const client = await pool.connect();
  try {
    await seedGoldenDataset(client as never);
  } finally {
    client.release();
  }
  // An empty price cache: only the listings and companies stay.
  await pool.query(`delete from market_bars`);
  await pool.query(`delete from market_bar_ranges`);

  // A live turn, now: the provider's prices step up 20% at this year's start.
  const yearStart = zonedDateStartUtcIso(`${ytdYear(new Date().toISOString(), NY)}-01-01`, NY);
  const provider = fakeProvider(yearStart);
  const cache = createPostgresMarketCacheRepository(pool);
  const server = createMarketServer({
    adapter: createCachedMarketDataAdapter({ provider: provider.adapter, cache }),
    listings: createPostgresListingRepository(pool),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  registerLifoCleanup(t, () => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const chart = async (asOf: string) =>
    (await loadPerfComparisonBlocks(pool, { listings: LISTINGS, snapshotId: "64000000-0000-4000-8000-0000000000d1", asOf, window: "ytd" }))[0];

  await hydrateYtdBars({ origin, listings: LISTINGS, now: new Date().toISOString() });
  assert.equal(provider.calls(), 2, "one provider fetch per company");

  // The cutoff is taken after the fetch (as local-runtime does), so the stored
  // bars are inside it.
  const cutoff = new Date().toISOString();
  const drawn = await chart(cutoff);
  assert.equal(drawn?.kind, "perf_comparison");
  assert.match(String(drawn.default_range), /^YTD \d{4}: \d{4}-12-\d{2} close to \d{4}-\d{2}-\d{2} close/);
  const lines = drawn.series as Array<{ points: Array<{ y: number }> }>;
  assert.ok(lines.every((line) => Math.abs(line.points.at(-1)!.y - 20) < 1e-9));

  // Asking again reuses what the first ask stored.
  await hydrateYtdBars({ origin, listings: LISTINGS, now: new Date().toISOString() });
  assert.equal(provider.calls(), 2, "the repeat ask is served from the cache");

  // A write landing after the cutoff (a fetch that outlived its client timeout)
  // is not read at that cutoff, so it can never enter that turn's snapshot.
  const [nvdaSpec] = drawn.provenance_series_specs as Array<{ range: { start: string; end: string } }>;
  const late = await fakeProvider(yearStart, 10).adapter.getBars({
    listing: { kind: "listing", id: LISTINGS[0].id },
    interval: "1d",
    range: nvdaSpec.range,
    adjustment_basis: "split_adjusted",
  });
  assert.ok(late.outcome === "available");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const storedAt = new Date().toISOString();
  await cache.storeBars(late.data, { provider: "polygon", fetched_at: storedAt, expires_at: "2126-01-01T00:00:00.000Z" });
  const atCutoff = await chart(cutoff);
  assert.notEqual(atCutoff?.kind, "perf_comparison", "the range rewritten after the cutoff is not read at it");
  assert.equal((await chart(new Date().toISOString()))?.kind, "perf_comparison", "a later turn reads it");
});
