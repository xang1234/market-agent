import test from "node:test";
import assert from "node:assert/strict";
import { createCachedMarketDataAdapter } from "../src/cached-adapter.ts";
import { createInMemoryMarketCacheRepository } from "../src/cache-repository.ts";
import { available, isAvailable } from "../src/availability.ts";
import { normalizedQuote } from "../src/quote.ts";
import type { MarketDataAdapter } from "../src/adapter.ts";
import { aaplListing } from "./fixtures.ts";

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
