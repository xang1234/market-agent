import test from "node:test";
import assert from "node:assert/strict";
import { createCachedMarketDataAdapter } from "../src/cached-adapter.ts";
import { createInMemoryMarketCacheRepository } from "../src/cache-repository.ts";
import { available, isAvailable } from "../src/availability.ts";
import { normalizedBars } from "../src/bar.ts";
import { normalizedQuote } from "../src/quote.ts";
import { STOOQ_MARKET_SOURCE_ID } from "../src/provider-sources.ts";
import type { MarketDataAdapter } from "../src/adapter.ts";
import { aaplBarRange, aaplListing } from "./fixtures.ts";

const YAHOO_MARKET_SOURCE_ID = "00000000-0000-4000-a000-00000000000b";

test("cached adapter stores actual market source provider names for fallback outcomes", async () => {
  const cache = createInMemoryMarketCacheRepository();
  const provider: MarketDataAdapter = {
    providerName: "market-provider-fallback",
    sourceId: "00000000-0000-4000-a000-000000000009",
    async getQuote() {
      return available(
        normalizedQuote({
          listing: aaplListing,
          price: 189,
          prev_close: 187,
          session_state: "regular",
          as_of: "2026-05-08T20:00:00.000Z",
          delay_class: "delayed_15m",
          currency: "USD",
          source_id: YAHOO_MARKET_SOURCE_ID,
        }),
      );
    },
    async getBars() {
      throw new Error("not used");
    },
  };
  const adapter = createCachedMarketDataAdapter({
    provider,
    cache,
    clock: () => new Date("2026-05-08T20:05:00.000Z"),
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });

  assert.equal(isAvailable(outcome), true);
  const cached = await cache.findLatestQuote(aaplListing);
  assert.equal(cached?.provider, "yahoo_finance_dev_market");
});

test("cached adapter stores and serves Stooq daily bars through the normal bars cache path", async () => {
  const cache = createInMemoryMarketCacheRepository();
  let providerCalls = 0;
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
    source_id: STOOQ_MARKET_SOURCE_ID,
    adjustment_basis: "split_and_div_adjusted",
  });
  const provider: MarketDataAdapter = {
    providerName: "market-provider-fallback",
    sourceId: "00000000-0000-4000-a000-000000000009",
    async getQuote() {
      throw new Error("not used");
    },
    async getBars() {
      providerCalls++;
      return available(stooqBars);
    },
  };
  const adapter = createCachedMarketDataAdapter({
    provider,
    cache,
    clock: () => new Date("2026-05-08T20:05:00.000Z"),
  });

  const first = await adapter.getBars({ listing: aaplListing, interval: "1d", range: aaplBarRange });
  const second = await adapter.getBars({ listing: aaplListing, interval: "1d", range: aaplBarRange });

  assert.equal(isAvailable(first), true);
  assert.equal(isAvailable(second), true);
  assert.equal(providerCalls, 1);
  const cached = await cache.findLatestBars(
    aaplListing,
    "1d",
    aaplBarRange,
    "split_and_div_adjusted",
  );
  assert.equal(cached?.provider, "stooq_market");
});
