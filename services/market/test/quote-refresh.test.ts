import test from "node:test";
import assert from "node:assert/strict";

import type { MarketDataAdapter } from "../src/adapter.ts";
import { available, unavailable } from "../src/availability.ts";
import { createInMemoryMarketCacheRepository } from "../src/cache-repository.ts";
import { normalizedQuote } from "../src/quote.ts";
import { runQuoteRefreshOnce } from "../src/quote-refresh.ts";

const SOURCE_ID = "00000000-0000-4000-a000-000000000009";
const A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const NOW = new Date("2026-06-03T00:00:00.000Z");
const clock = () => NOW;

async function seedStaleActive(
  repo: ReturnType<typeof createInMemoryMarketCacheRepository>,
  id: string,
): Promise<void> {
  await repo.storeQuote(
    normalizedQuote({
      listing: { kind: "listing", id },
      price: 10,
      prev_close: 9,
      session_state: "regular",
      as_of: "2026-06-02T00:00:00.000Z",
      delay_class: "delayed_15m",
      currency: "USD",
      source_id: SOURCE_ID,
    }),
    {
      provider: "polygon_market",
      fetched_at: "2026-06-02T12:00:00.000Z",
      expires_at: "2026-06-02T12:30:00.000Z",
    },
  );
}

function quoteFor(id: string) {
  return normalizedQuote({
    listing: { kind: "listing", id },
    price: 20,
    prev_close: 19,
    session_state: "regular",
    as_of: NOW.toISOString(),
    delay_class: "delayed_15m",
    currency: "USD",
    source_id: SOURCE_ID,
  });
}

test("runQuoteRefreshOnce refreshes each stale-active listing and tallies results", async () => {
  const cache = createInMemoryMarketCacheRepository();
  await seedStaleActive(cache, A);
  await seedStaleActive(cache, B);
  const seen: string[] = [];
  const adapter: MarketDataAdapter = {
    providerName: "fake",
    sourceId: SOURCE_ID,
    async getQuote({ listing }) {
      seen.push(listing.id);
      return available(quoteFor(listing.id));
    },
    async getBars() {
      throw new Error("unused");
    },
  };

  const summary = await runQuoteRefreshOnce({ cache, adapter, clock });

  assert.deepEqual(summary, { scanned: 2, refreshed: 2, failed: 0 });
  assert.deepEqual([...seen].sort(), [A, B].sort());
});

test("runQuoteRefreshOnce counts an unavailable provider as failed and logs it", async () => {
  const cache = createInMemoryMarketCacheRepository();
  await seedStaleActive(cache, A);
  const events: unknown[] = [];
  const adapter: MarketDataAdapter = {
    providerName: "fake",
    sourceId: SOURCE_ID,
    async getQuote({ listing }) {
      return unavailable({
        reason: "provider_error",
        listing,
        source_id: SOURCE_ID,
        as_of: NOW.toISOString(),
        retryable: true,
        detail: "boom",
      });
    },
    async getBars() {
      throw new Error("unused");
    },
  };

  const summary = await runQuoteRefreshOnce({
    cache,
    adapter,
    clock,
    log: (event) => events.push(event),
  });

  assert.deepEqual(summary, { scanned: 1, refreshed: 0, failed: 1 });
  assert.equal(events.length, 1);
});

test("runQuoteRefreshOnce does nothing when no listings are stale-active", async () => {
  const cache = createInMemoryMarketCacheRepository();
  let called = 0;
  const adapter: MarketDataAdapter = {
    providerName: "fake",
    sourceId: SOURCE_ID,
    async getQuote({ listing }) {
      called++;
      return available(quoteFor(listing.id));
    },
    async getBars() {
      throw new Error("unused");
    },
  };

  const summary = await runQuoteRefreshOnce({ cache, adapter, clock });

  assert.deepEqual(summary, { scanned: 0, refreshed: 0, failed: 0 });
  assert.equal(called, 0);
});

test("runQuoteRefreshOnce passes the limit through to the cache query", async () => {
  const cache = createInMemoryMarketCacheRepository();
  await seedStaleActive(cache, A);
  await seedStaleActive(cache, B);
  let called = 0;
  const adapter: MarketDataAdapter = {
    providerName: "fake",
    sourceId: SOURCE_ID,
    async getQuote({ listing }) {
      called++;
      return available(quoteFor(listing.id));
    },
    async getBars() {
      throw new Error("unused");
    },
  };

  const summary = await runQuoteRefreshOnce({ cache, adapter, clock, limit: 1 });

  assert.equal(summary.scanned, 1);
  assert.equal(called, 1);
});
