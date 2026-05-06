import test from "node:test";
import assert from "node:assert/strict";
import {
  createFallbackMarketDataAdapter,
  type ProviderAuditEvent,
} from "../src/provider-fallback.ts";
import {
  available,
  isAvailable,
  unavailable,
  type MarketDataAdapter,
  normalizedQuote,
  normalizedBars,
} from "../src/adapter.ts";
import { aaplBarRange, aaplListing, FIXTURE_SOURCE_ID } from "./fixtures.ts";

const FALLBACK_SOURCE_ID = "22222222-2222-4222-8222-222222222222";

test("fallback adapter serves quote from fallback provider after retryable primary provider failure", async () => {
  const events: ProviderAuditEvent[] = [];
  const primary: MarketDataAdapter = {
    providerName: "primary",
    sourceId: FIXTURE_SOURCE_ID,
    async getQuote() {
      return unavailable({
        reason: "provider_error",
        listing: aaplListing,
        source_id: FIXTURE_SOURCE_ID,
        retryable: true,
        detail: "primary: 503",
        as_of: "2026-04-22T20:00:00.000Z",
      });
    },
    async getBars() {
      throw new Error("not used");
    },
  };
  const fallbackQuote = normalizedQuote({
    listing: aaplListing,
    price: 189,
    prev_close: 187,
    session_state: "regular",
    as_of: "2026-04-22T20:00:00.000Z",
    delay_class: "delayed_15m",
    currency: "USD",
    source_id: FALLBACK_SOURCE_ID,
  });
  const fallback: MarketDataAdapter = {
    providerName: "fallback",
    sourceId: FALLBACK_SOURCE_ID,
    async getQuote() {
      return available(fallbackQuote);
    },
    async getBars() {
      throw new Error("not used");
    },
  };

  const adapter = createFallbackMarketDataAdapter({
    providerName: "market-fallback",
    adapters: [primary, fallback],
    onAuditEvent: (event) => events.push(event),
    clock: () => new Date("2026-04-22T20:00:01.000Z"),
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });

  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  assert.equal(outcome.data.source_id, FALLBACK_SOURCE_ID);
  assert.deepEqual(
    events.map((event) => ({
      providerName: event.providerName,
      operation: event.operation,
      result: event.result,
      fallbackEligible: event.fallbackEligible,
    })),
    [
      {
        providerName: "primary",
        operation: "quote",
        result: "unavailable",
        fallbackEligible: true,
      },
      {
        providerName: "fallback",
        operation: "quote",
        result: "available",
        fallbackEligible: false,
      },
    ],
  );
});

test("fallback adapter stops on non-retryable provider failures", async () => {
  let fallbackCalls = 0;
  const primary: MarketDataAdapter = {
    providerName: "primary",
    sourceId: FIXTURE_SOURCE_ID,
    async getQuote() {
      return unavailable({
        reason: "provider_error",
        listing: aaplListing,
        source_id: FIXTURE_SOURCE_ID,
        retryable: false,
        detail: "primary: unauthorized",
        as_of: "2026-04-22T20:00:00.000Z",
      });
    },
    async getBars() {
      throw new Error("not used");
    },
  };
  const fallback: MarketDataAdapter = {
    providerName: "fallback",
    sourceId: FALLBACK_SOURCE_ID,
    async getQuote() {
      fallbackCalls++;
      return available(
        normalizedQuote({
          listing: aaplListing,
          price: 189,
          prev_close: 187,
          session_state: "regular",
          as_of: "2026-04-22T20:00:00.000Z",
          delay_class: "delayed_15m",
          currency: "USD",
          source_id: FALLBACK_SOURCE_ID,
        }),
      );
    },
    async getBars() {
      throw new Error("not used");
    },
  };

  const adapter = createFallbackMarketDataAdapter({
    providerName: "market-fallback",
    adapters: [primary, fallback],
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });

  assert.equal(isAvailable(outcome), false);
  assert.equal(fallbackCalls, 0);
});

test("fallback adapter serves bars from fallback provider after retryable primary provider failure", async () => {
  const primary: MarketDataAdapter = {
    providerName: "primary",
    sourceId: FIXTURE_SOURCE_ID,
    async getQuote() {
      throw new Error("not used");
    },
    async getBars() {
      return unavailable({
        reason: "provider_error",
        listing: aaplListing,
        source_id: FIXTURE_SOURCE_ID,
        retryable: true,
        detail: "primary: 429",
        as_of: "2026-04-22T20:00:00.000Z",
      });
    },
  };
  const fallbackBars = normalizedBars({
    listing: aaplListing,
    interval: "1d",
    range: aaplBarRange,
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
    source_id: FALLBACK_SOURCE_ID,
    adjustment_basis: "split_and_div_adjusted",
  });
  const fallback: MarketDataAdapter = {
    providerName: "fallback",
    sourceId: FALLBACK_SOURCE_ID,
    async getQuote() {
      throw new Error("not used");
    },
    async getBars() {
      return available(fallbackBars);
    },
  };

  const adapter = createFallbackMarketDataAdapter({
    providerName: "market-fallback",
    adapters: [primary, fallback],
  });

  const outcome = await adapter.getBars({
    listing: aaplListing,
    interval: "1d",
    range: aaplBarRange,
  });

  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  assert.equal(outcome.data.source_id, FALLBACK_SOURCE_ID);
});

test("fallback adapter returns sanitized unavailable envelope when every provider throws", async () => {
  const events: ProviderAuditEvent[] = [];
  const throwing: MarketDataAdapter = {
    providerName: "throwing",
    sourceId: FIXTURE_SOURCE_ID,
    async getQuote() {
      throw new Error("vendor secret: raw 503 body");
    },
    async getBars() {
      throw new Error("not used");
    },
  };

  const adapter = createFallbackMarketDataAdapter({
    providerName: "market-fallback",
    adapters: [throwing],
    onAuditEvent: (event) => events.push(event),
    clock: () => new Date("2026-04-22T20:00:00.000Z"),
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });

  assert.equal(outcome.outcome, "unavailable");
  if (outcome.outcome !== "unavailable") return;
  assert.equal(outcome.reason, "provider_error");
  assert.equal(outcome.retryable, true);
  assert.equal(outcome.detail, "all fallback providers failed");
  assert.equal(events[0].reason, "provider threw");
});

test("fallback adapter stops when a thrown provider error is non-retryable", async () => {
  const events: ProviderAuditEvent[] = [];
  let fallbackCalls = 0;
  const primary: MarketDataAdapter = {
    providerName: "primary",
    sourceId: FIXTURE_SOURCE_ID,
    async getQuote() {
      const error = new Error("primary: unauthorized") as Error & { status: number };
      error.status = 401;
      throw error;
    },
    async getBars() {
      throw new Error("not used");
    },
  };
  const fallback: MarketDataAdapter = {
    providerName: "fallback",
    sourceId: FALLBACK_SOURCE_ID,
    async getQuote() {
      fallbackCalls++;
      return available(
        normalizedQuote({
          listing: aaplListing,
          price: 189,
          prev_close: 187,
          session_state: "regular",
          as_of: "2026-04-22T20:00:00.000Z",
          delay_class: "delayed_15m",
          currency: "USD",
          source_id: FALLBACK_SOURCE_ID,
        }),
      );
    },
    async getBars() {
      throw new Error("not used");
    },
  };

  const adapter = createFallbackMarketDataAdapter({
    providerName: "market-fallback",
    adapters: [primary, fallback],
    onAuditEvent: (event) => events.push(event),
    clock: () => new Date("2026-04-22T20:00:00.000Z"),
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });

  assert.equal(outcome.outcome, "unavailable");
  if (outcome.outcome !== "unavailable") return;
  assert.equal(outcome.reason, "provider_error");
  assert.equal(outcome.retryable, false);
  assert.equal(fallbackCalls, 0);
  assert.equal(events[0].fallbackEligible, false);
});
