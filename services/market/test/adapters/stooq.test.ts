import test from "node:test";
import assert from "node:assert/strict";

import { createStooqMarketDataAdapter } from "../../src/adapters/stooq.ts";
import { isAvailable } from "../../src/adapter.ts";
import { STOOQ_MARKET_SOURCE_ID } from "../../src/provider-sources.ts";
import { aaplListing } from "../fixtures.ts";

const listingContext = {
  ticker: "AAPL",
  mic: "XNAS",
  currency: "USD",
  timezone: "America/New_York",
};

const dailyRange = {
  start: "2026-05-06T04:00:00.000Z",
  end: "2026-05-09T04:00:00.000Z",
};

test("Stooq adapter parses CSV daily bars into normalized EOD market data", async () => {
  const requests: string[] = [];
  const adapter = createStooqMarketDataAdapter({
    baseUrl: "https://stooq.test/q/d/l/",
    sourceId: STOOQ_MARKET_SOURCE_ID,
    resolveListing: async () => listingContext,
    fetchImpl: async (url) => {
      requests.push(String(url));
      return new Response(
        [
          "Date,Open,High,Low,Close,Volume",
          "2026-05-06,100,103,99,102,1000",
          "2026-05-07,102,104,101,103,1200",
          "2026-05-09,999,999,999,999,1",
        ].join("\n"),
      );
    },
    clock: () => new Date("2026-05-10T12:00:00.000Z"),
  });

  const outcome = await adapter.getBars({ listing: aaplListing, interval: "1d", range: dailyRange });

  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  assert.equal(outcome.data.source_id, STOOQ_MARKET_SOURCE_ID);
  assert.equal(outcome.data.delay_class, "eod");
  assert.equal(outcome.data.currency, "USD");
  assert.equal(outcome.data.adjustment_basis, "split_and_div_adjusted");
  assert.deepEqual(
    outcome.data.bars.map((bar) => [bar.ts, bar.open, bar.high, bar.low, bar.close, bar.volume]),
    [
      ["2026-05-06T04:00:00.000Z", 100, 103, 99, 102, 1000],
      ["2026-05-07T04:00:00.000Z", 102, 104, 101, 103, 1200],
    ],
  );
  assert.match(requests[0] ?? "", /s=aapl\.us/);
  assert.match(requests[0] ?? "", /i=d/);
  assert.match(requests[0] ?? "", /d1=20260506/);
  assert.match(requests[0] ?? "", /d2=20260508/);
});

test("Stooq adapter returns unavailable for quotes and intraday bars", async () => {
  let fetchCalls = 0;
  const adapter = createStooqMarketDataAdapter({
    baseUrl: "https://stooq.test/q/d/l/",
    sourceId: STOOQ_MARKET_SOURCE_ID,
    resolveListing: async () => listingContext,
    fetchImpl: async () => {
      fetchCalls++;
      return new Response("Date,Open,High,Low,Close,Volume\n");
    },
    clock: () => new Date("2026-05-10T12:00:00.000Z"),
  });

  const quote = await adapter.getQuote({ listing: aaplListing });
  const intraday = await adapter.getBars({ listing: aaplListing, interval: "15m", range: dailyRange });

  assert.equal(quote.outcome, "unavailable");
  assert.equal(quote.reason, "missing_coverage");
  assert.equal(quote.retryable, false);
  assert.match(quote.detail ?? "", /EOD daily bars only/);
  assert.equal(intraday.outcome, "unavailable");
  assert.equal(intraday.reason, "missing_coverage");
  assert.equal(intraday.retryable, false);
  assert.match(intraday.detail ?? "", /interval 15m/);
  assert.equal(fetchCalls, 0);
});

test("Stooq adapter handles empty, malformed, provider, and unsupported listing responses deterministically", async () => {
  const unsupported = createStooqMarketDataAdapter({
    baseUrl: "https://stooq.test/q/d/l/",
    sourceId: STOOQ_MARKET_SOURCE_ID,
    resolveListing: async () => ({ ...listingContext, mic: "XLON" }),
    clock: () => new Date("2026-05-10T12:00:00.000Z"),
  });
  assert.deepEqual(
    await unsupported.getBars({ listing: aaplListing, interval: "1d", range: dailyRange }),
    {
      outcome: "unavailable",
      reason: "missing_coverage",
      listing: aaplListing,
      source_id: STOOQ_MARKET_SOURCE_ID,
      as_of: "2026-05-10T12:00:00.000Z",
      retryable: false,
      detail: "stooq: MIC XLON is not supported by the MVP Stooq adapter",
    },
  );

  const empty = createStooqMarketDataAdapter({
    baseUrl: "https://stooq.test/q/d/l/",
    sourceId: STOOQ_MARKET_SOURCE_ID,
    resolveListing: async () => listingContext,
    fetchImpl: async () => new Response("Date,Open,High,Low,Close,Volume\n"),
    clock: () => new Date("2026-05-10T12:00:00.000Z"),
  });
  const emptyOutcome = await empty.getBars({ listing: aaplListing, interval: "1d", range: dailyRange });
  assert.equal(emptyOutcome.outcome, "unavailable");
  assert.equal(emptyOutcome.reason, "missing_coverage");
  assert.equal(emptyOutcome.retryable, false);

  const malformed = createStooqMarketDataAdapter({
    baseUrl: "https://stooq.test/q/d/l/",
    sourceId: STOOQ_MARKET_SOURCE_ID,
    resolveListing: async () => listingContext,
    fetchImpl: async () => new Response("Date,Open,High,Low,Close,Volume\n2026-05-06,100,90,99,102,1000\n"),
    clock: () => new Date("2026-05-10T12:00:00.000Z"),
  });
  const malformedOutcome = await malformed.getBars({ listing: aaplListing, interval: "1d", range: dailyRange });
  assert.equal(malformedOutcome.outcome, "unavailable");
  assert.equal(malformedOutcome.reason, "provider_error");
  assert.equal(malformedOutcome.retryable, false);
  assert.match(malformedOutcome.detail ?? "", /malformed CSV row/);

  const rateLimited = createStooqMarketDataAdapter({
    baseUrl: "https://stooq.test/q/d/l/",
    sourceId: STOOQ_MARKET_SOURCE_ID,
    resolveListing: async () => listingContext,
    fetchImpl: async () => new Response("slow down", { status: 429 }),
    clock: () => new Date("2026-05-10T12:00:00.000Z"),
  });
  const rateLimitedOutcome = await rateLimited.getBars({ listing: aaplListing, interval: "1d", range: dailyRange });
  assert.equal(rateLimitedOutcome.outcome, "unavailable");
  assert.equal(rateLimitedOutcome.reason, "rate_limited");
  assert.equal(rateLimitedOutcome.retryable, true);

  const providerDown = createStooqMarketDataAdapter({
    baseUrl: "https://stooq.test/q/d/l/",
    sourceId: STOOQ_MARKET_SOURCE_ID,
    resolveListing: async () => listingContext,
    fetchImpl: async () => new Response("temporary outage", { status: 503 }),
    clock: () => new Date("2026-05-10T12:00:00.000Z"),
  });
  const providerDownOutcome = await providerDown.getBars({ listing: aaplListing, interval: "1d", range: dailyRange });
  assert.equal(providerDownOutcome.outcome, "unavailable");
  assert.equal(providerDownOutcome.reason, "provider_error");
  assert.equal(providerDownOutcome.retryable, true);
});
