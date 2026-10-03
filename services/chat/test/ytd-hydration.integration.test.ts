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

// A provider with split-adjusted weekday closes: 100 (NVDA) or 50 (AMD) through
// 2025, then 20% higher. Counts its calls.
function fakeProvider() {
  let calls = 0;
  const adapter: MarketDataAdapter = {
    providerName: "polygon",
    sourceId: MARKET_SOURCE_ID,
    async getQuote(request) {
      return unavailable({ reason: "missing_coverage", listing: request.listing, source_id: MARKET_SOURCE_ID, as_of: GOLDEN_AS_OF, retryable: false });
    },
    async getBars(request: BarsRequest) {
      calls += 1;
      const base = request.listing.id === LISTINGS[0].id ? 100 : 50;
      const bars = [];
      for (let day = new Date(request.range.start); day.getTime() < Date.parse(request.range.end); day.setUTCDate(day.getUTCDate() + 1)) {
        const ts = zonedDateStartUtcIso(day.toISOString().slice(0, 10), NY);
        if (Date.parse(ts) < Date.parse(request.range.start) || Date.parse(ts) >= Date.parse(request.range.end)) continue;
        if (new Date(ts).getUTCDay() === 0 || new Date(ts).getUTCDay() === 6) continue;
        const close = ts < "2026-01-01" ? base : base * 1.2;
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

  const provider = fakeProvider();
  const clock = () => new Date(GOLDEN_AS_OF);
  const server = createMarketServer({
    adapter: createCachedMarketDataAdapter({ provider: provider.adapter, cache: createPostgresMarketCacheRepository(pool), clock }),
    listings: createPostgresListingRepository(pool),
    clock,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  registerLifoCleanup(t, () => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await hydrateYtdBars({ origin, listings: LISTINGS, now: GOLDEN_AS_OF });
  assert.equal(provider.calls(), 2, "one provider fetch per company");

  // Charted at a cutoff taken after the fetch (local-runtime captures it after
  // hydrating), so the stored bars are inside it.
  const [chart] = await loadPerfComparisonBlocks(pool, { listings: LISTINGS, snapshotId: "64000000-0000-4000-8000-0000000000d1", asOf: GOLDEN_AS_OF, window: "ytd" });
  assert.equal(chart?.kind, "perf_comparison");
  assert.equal(chart.default_range, "YTD 2026: 2025-12-31 close to 2026-08-31 close");
  const lines = chart.series as Array<{ points: Array<{ y: number }> }>;
  assert.ok(lines.every((line) => Math.abs(line.points.at(-1)!.y - 20) < 1e-9));

  // Asking again reuses what the first ask stored.
  await hydrateYtdBars({ origin, listings: LISTINGS, now: GOLDEN_AS_OF });
  assert.equal(provider.calls(), 2, "the repeat ask is served from the cache");
});
