import test from "node:test";
import assert from "node:assert/strict";

import { available, isAvailable, normalizedBars, unavailable, type MarketDataAdapter } from "../src/adapter.ts";
import { createDailyBarsAwareFallbackMarketDataAdapter } from "../src/provider-composition.ts";
import { aaplBarRange, aaplListing, FIXTURE_SOURCE_ID } from "./fixtures.ts";

const STOOQ_SOURCE_ID = "00000000-0000-4000-a000-000000000011";

test("daily-bars-aware fallback only routes Stooq into eligible daily bar requests", async () => {
  const calls: string[] = [];
  const primary: MarketDataAdapter = {
    providerName: "polygon",
    sourceId: FIXTURE_SOURCE_ID,
    async getQuote() {
      calls.push("primary:quote");
      return unavailable({
        reason: "provider_error",
        listing: aaplListing,
        source_id: FIXTURE_SOURCE_ID,
        as_of: "2026-05-10T12:00:00.000Z",
        retryable: true,
      });
    },
    async getBars(request) {
      calls.push(`primary:bars:${request.interval}`);
      return unavailable({
        reason: "missing_coverage",
        listing: request.listing,
        source_id: FIXTURE_SOURCE_ID,
        as_of: "2026-05-10T12:00:00.000Z",
        retryable: false,
      });
    },
  };
  const stooqBars = normalizedBars({
    listing: aaplListing,
    interval: "1d",
    range: aaplBarRange,
    bars: [
      {
        ts: aaplBarRange.start,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 10_000,
      },
    ],
    as_of: aaplBarRange.start,
    delay_class: "eod",
    currency: "USD",
    source_id: STOOQ_SOURCE_ID,
    adjustment_basis: "split_and_div_adjusted",
  });
  const stooq: MarketDataAdapter = {
    providerName: "stooq_market",
    sourceId: STOOQ_SOURCE_ID,
    async getQuote() {
      calls.push("stooq:quote");
      throw new Error("Stooq must not be called for quotes");
    },
    async getBars(request) {
      calls.push(`stooq:bars:${request.interval}`);
      return available(stooqBars);
    },
  };

  const adapter = createDailyBarsAwareFallbackMarketDataAdapter({
    providerName: "market-provider-fallback",
    realtimeAdapters: [primary],
    dailyBarsFallbackAdapters: [stooq],
  });

  const quote = await adapter.getQuote({ listing: aaplListing });
  const intraday = await adapter.getBars({ listing: aaplListing, interval: "15m", range: aaplBarRange });
  const daily = await adapter.getBars({ listing: aaplListing, interval: "1d", range: aaplBarRange });

  assert.equal(quote.outcome, "unavailable");
  assert.equal(intraday.outcome, "unavailable");
  assert.equal(isAvailable(daily), true);
  if (!isAvailable(daily)) return;
  assert.equal(daily.data.source_id, STOOQ_SOURCE_ID);
  assert.deepEqual(calls, [
    "primary:quote",
    "primary:bars:15m",
    "primary:bars:1d",
    "stooq:bars:1d",
  ]);
});
