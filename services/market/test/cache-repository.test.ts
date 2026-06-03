import test from "node:test";
import assert from "node:assert/strict";
import { createInMemoryMarketCacheRepository } from "../src/cache-repository.ts";
import { normalizedQuote } from "../src/quote.ts";
import { normalizedBars } from "../src/bar.ts";

const LISTING_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const SOURCE_ID = "00000000-0000-4000-a000-000000000009";
const LISTING = Object.freeze({ kind: "listing" as const, id: LISTING_ID });

test("market cache repository serves fresh quotes and reports expired quotes separately", async () => {
  const repo = createInMemoryMarketCacheRepository();
  const quote = normalizedQuote({
    listing: LISTING,
    price: 101,
    prev_close: 100,
    session_state: "regular",
    as_of: "2026-05-08T13:45:00.000Z",
    delay_class: "delayed_15m",
    currency: "USD",
    source_id: SOURCE_ID,
  });

  await repo.storeQuote(quote, {
    fetched_at: "2026-05-08T13:46:00.000Z",
    expires_at: "2026-05-08T14:16:00.000Z",
    provider: "polygon",
  });

  assert.equal((await repo.findFreshQuote(LISTING, "2026-05-08T14:15:59.000Z"))?.quote.price, 101);
  assert.equal(await repo.findFreshQuote(LISTING, "2026-05-08T14:16:00.000Z"), null);
  assert.equal((await repo.findLatestQuote(LISTING))?.quote.price, 101);
});

test("market cache repository stores bars by canonical interval, basis, and range", async () => {
  const repo = createInMemoryMarketCacheRepository();
  const bars = normalizedBars({
    listing: LISTING,
    interval: "1d",
    range: {
      start: "2026-05-06T00:00:00.000Z",
      end: "2026-05-08T00:00:00.000Z",
    },
    bars: [
      { ts: "2026-05-06T04:00:00.000Z", open: 98, high: 102, low: 97, close: 101, volume: 1000 },
      { ts: "2026-05-07T04:00:00.000Z", open: 101, high: 103, low: 100, close: 102, volume: 1200 },
    ],
    as_of: "2026-05-07T04:00:00.000Z",
    delay_class: "eod",
    currency: "USD",
    source_id: SOURCE_ID,
    adjustment_basis: "split_and_div_adjusted",
  });

  await repo.storeBars(bars, {
    fetched_at: "2026-05-08T12:00:00.000Z",
    expires_at: "2026-05-11T00:00:00.000Z",
    provider: "polygon",
  });

  const hit = await repo.findFreshBars({
    listing: LISTING,
    interval: "1d",
    range: bars.range,
    adjustment_basis: "split_and_div_adjusted",
    now: "2026-05-08T12:05:00.000Z",
  });

  assert.deepEqual(hit?.bars.bars.map((bar) => bar.close), [101, 102]);
  assert.equal(
    await repo.findFreshBars({
      listing: LISTING,
      interval: "1d",
      range: bars.range,
      adjustment_basis: "unadjusted",
      now: "2026-05-08T12:05:00.000Z",
    }),
    null,
  );
});

// ── listStaleActiveListings ───────────────────────────────────────────────────

const STALE_ACTIVE = "11111111-1111-4111-a111-111111111111";
const FRESH_LATEST = "22222222-2222-4222-a222-222222222222";
const STALE_INACTIVE = "33333333-3333-4333-a333-333333333333";

// now = 2026-06-03T00:00Z, activeSince = 2026-05-27T00:00Z (7-day window)
const NOW_ISO = "2026-06-03T00:00:00.000Z";
const ACTIVE_SINCE_ISO = "2026-05-27T00:00:00.000Z";

async function storeQuoteRow(
  repo: ReturnType<typeof createInMemoryMarketCacheRepository>,
  id: string,
  opts: { as_of: string; fetched_at: string; expires_at: string },
): Promise<void> {
  await repo.storeQuote(
    normalizedQuote({
      listing: { kind: "listing", id },
      price: 10,
      prev_close: 9,
      session_state: "regular",
      as_of: opts.as_of,
      delay_class: "delayed_15m",
      currency: "USD",
      source_id: SOURCE_ID,
    }),
    { provider: "polygon_market", fetched_at: opts.fetched_at, expires_at: opts.expires_at },
  );
}

test("listStaleActiveListings returns listings whose latest row is stale and recently active", async () => {
  const repo = createInMemoryMarketCacheRepository();
  // STALE_ACTIVE: latest row expired, fetched within window → included.
  await storeQuoteRow(repo, STALE_ACTIVE, {
    as_of: "2026-06-02T00:00:00.000Z",
    fetched_at: "2026-06-02T12:00:00.000Z",
    expires_at: "2026-06-02T12:30:00.000Z",
  });
  // FRESH_LATEST: an old expired row AND a newer fresh row → latest is fresh → excluded.
  await storeQuoteRow(repo, FRESH_LATEST, {
    as_of: "2026-06-01T00:00:00.000Z",
    fetched_at: "2026-06-01T12:00:00.000Z",
    expires_at: "2026-06-01T12:30:00.000Z",
  });
  await storeQuoteRow(repo, FRESH_LATEST, {
    as_of: "2026-06-02T23:00:00.000Z",
    fetched_at: "2026-06-02T23:00:00.000Z",
    expires_at: "2026-06-03T05:00:00.000Z",
  });
  // STALE_INACTIVE: expired and fetched before the window → excluded.
  await storeQuoteRow(repo, STALE_INACTIVE, {
    as_of: "2026-05-20T00:00:00.000Z",
    fetched_at: "2026-05-20T12:00:00.000Z",
    expires_at: "2026-05-20T12:30:00.000Z",
  });

  const result = await repo.listStaleActiveListings({
    now: NOW_ISO,
    activeSince: ACTIVE_SINCE_ISO,
    limit: 200,
  });

  assert.deepEqual(result, [{ kind: "listing", id: STALE_ACTIVE }]);
});

test("listStaleActiveListings orders by fetched_at desc and respects limit", async () => {
  const repo = createInMemoryMarketCacheRepository();
  const OLDER = "44444444-4444-4444-a444-444444444444";
  const NEWER = "55555555-5555-4555-a555-555555555555";
  await storeQuoteRow(repo, OLDER, {
    as_of: "2026-06-01T00:00:00.000Z",
    fetched_at: "2026-06-01T00:00:00.000Z",
    expires_at: "2026-06-01T00:30:00.000Z",
  });
  await storeQuoteRow(repo, NEWER, {
    as_of: "2026-06-02T00:00:00.000Z",
    fetched_at: "2026-06-02T00:00:00.000Z",
    expires_at: "2026-06-02T00:30:00.000Z",
  });

  const result = await repo.listStaleActiveListings({
    now: NOW_ISO,
    activeSince: ACTIVE_SINCE_ISO,
    limit: 1,
  });

  // NEWER has the greater fetched_at, so it wins the single slot.
  assert.deepEqual(result, [{ kind: "listing", id: NEWER }]);
});
