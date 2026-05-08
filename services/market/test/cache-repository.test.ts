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
