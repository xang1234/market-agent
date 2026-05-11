import test from "node:test";
import assert from "node:assert/strict";
import {
  createDevProvidersMarketDataAdapter,
} from "../../src/adapters/dev-providers.ts";
import {
  isAvailable,
  isUnavailable,
} from "../../src/availability.ts";
import {
  aaplBarRange,
  aaplListing,
} from "../fixtures.ts";

const YAHOO_MARKET_SOURCE_ID = "00000000-0000-4000-a000-00000000000b";

test("dev providers market adapter normalizes yfinance quote responses", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const adapter = createDevProvidersMarketDataAdapter({
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_MARKET_SOURCE_ID,
    resolveListing: async () => ({
      ticker: "AAPL",
      mic: "XNAS",
      currency: "USD",
      timezone: "America/New_York",
    }),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({
        status: "available",
        data: {
          price: 189.5,
          prev_close: 187.25,
          session_state: "regular",
          as_of: "2026-05-08T19:45:00.000Z",
          delay_class: "delayed_15m",
          currency: "USD",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });

  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  assert.equal(outcome.data.source_id, YAHOO_MARKET_SOURCE_ID);
  assert.equal(outcome.data.price, 189.5);
  assert.equal(outcome.data.prev_close, 187.25);
  assert.equal(calls[0].url, "http://dev-providers.test/market/quote");
  assert.deepEqual(calls[0].body, {
    listing: aaplListing,
    ticker: "AAPL",
    mic: "XNAS",
    currency: "USD",
    timezone: "America/New_York",
  });
});

test("dev providers market adapter returns adjusted daily bars for 1d requests", async () => {
  const adapter = createDevProvidersMarketDataAdapter({
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_MARKET_SOURCE_ID,
    resolveListing: async () => ({
      ticker: "AAPL",
      mic: "XNAS",
      currency: "USD",
      timezone: "America/New_York",
    }),
    fetchImpl: async () => new Response(JSON.stringify({
      status: "available",
      data: {
        bars: [
          {
            ts: aaplBarRange.start,
            open: 187,
            high: 190,
            low: 186,
            close: 189,
            volume: 10_000,
          },
        ],
        as_of: aaplBarRange.start,
        delay_class: "eod",
        currency: "USD",
        adjustment_basis: "split_and_div_adjusted",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const outcome = await adapter.getBars({ listing: aaplListing, interval: "1d", range: aaplBarRange });

  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  assert.equal(outcome.data.source_id, YAHOO_MARKET_SOURCE_ID);
  assert.equal(outcome.data.adjustment_basis, "split_and_div_adjusted");
  assert.equal(outcome.data.bars.length, 1);
});

test("dev providers market adapter does not call yfinance for intraday bars in slice 1", async () => {
  let called = false;
  const adapter = createDevProvidersMarketDataAdapter({
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_MARKET_SOURCE_ID,
    resolveListing: async () => ({
      ticker: "AAPL",
      mic: "XNAS",
      currency: "USD",
      timezone: "America/New_York",
    }),
    fetchImpl: async () => {
      called = true;
      throw new Error("should not call sidecar for intraday");
    },
    clock: () => new Date("2026-05-08T20:00:00.000Z"),
  });

  const outcome = await adapter.getBars({ listing: aaplListing, interval: "1h", range: aaplBarRange });

  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.equal(outcome.reason, "missing_coverage");
  assert.equal(outcome.retryable, false);
  assert.equal(called, false);
});

test("dev providers market adapter maps sidecar unavailable envelopes", async () => {
  const adapter = createDevProvidersMarketDataAdapter({
    baseUrl: "http://dev-providers.test",
    sourceId: YAHOO_MARKET_SOURCE_ID,
    resolveListing: async () => ({
      ticker: "AAPL",
      mic: "XNAS",
      currency: "USD",
      timezone: "America/New_York",
    }),
    fetchImpl: async () => new Response(JSON.stringify({
      status: "unavailable",
      reason: "rate_limited",
      retryable: true,
      detail: "yfinance throttled",
    }), { status: 200, headers: { "content-type": "application/json" } }),
    clock: () => new Date("2026-05-08T20:00:00.000Z"),
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });

  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.equal(outcome.reason, "rate_limited");
  assert.equal(outcome.retryable, true);
  assert.equal(outcome.source_id, YAHOO_MARKET_SOURCE_ID);
  assert.equal(outcome.detail, "yfinance throttled");
});
