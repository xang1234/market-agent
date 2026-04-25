import test from "node:test";
import assert from "node:assert/strict";
import type {
  MarketDataAdapter,
  NormalizedBars,
  NormalizedQuote,
} from "../src/adapter.ts";
import { normalizedQuote } from "../src/quote.ts";
import { available, isAvailable, isUnavailable } from "../src/availability.ts";
import { createPolygonAdapter, PolygonFetchError } from "../src/adapters/polygon.ts";
import type { ListingSubjectRef } from "../src/subject-ref.ts";
import {
  aaplCtx,
  aaplListing,
  aaplSnapshotPayload,
  FIXTURE_SOURCE_ID,
  makeRouteFetcher,
  POLYGON_DELAY_CLASS,
  POLYGON_SOURCE_ID,
  SNAPSHOT_PATH,
} from "./fixtures.ts";

async function priceSummaryConsumer(
  adapter: MarketDataAdapter,
  listing: ListingSubjectRef,
): Promise<{ price: number; currency: string; delay_class: string } | { unavailable: true }> {
  const outcome = await adapter.getQuote({ listing });
  if (isUnavailable(outcome)) return { unavailable: true };
  const quote = outcome.data;
  return {
    price: quote.price,
    currency: quote.currency,
    delay_class: quote.delay_class,
  };
}

function createFixtureAdapter(records: {
  quote: NormalizedQuote;
  bars: NormalizedBars;
}): MarketDataAdapter {
  return {
    providerName: "fixture",
    sourceId: FIXTURE_SOURCE_ID,
    async getQuote() {
      return available(records.quote);
    },
    async getBars() {
      return available(records.bars);
    },
  };
}

test("consumers receive identical normalized shapes from a fixture adapter and the polygon adapter", async () => {
  const expectedPrice = 187.42;
  const expectedPrevClose = 185.0;
  const expectedCurrency = "USD";

  const fixture = createFixtureAdapter({
    quote: normalizedQuote({
      listing: aaplListing,
      price: expectedPrice,
      prev_close: expectedPrevClose,
      session_state: "regular",
      as_of: new Date(1_700_000_000_000).toISOString(),
      delay_class: POLYGON_DELAY_CLASS,
      currency: expectedCurrency,
      source_id: FIXTURE_SOURCE_ID,
    }),
    bars: {
      listing: aaplListing,
      interval: "1d",
      range: {
        start: new Date(1_700_006_400_000).toISOString(),
        end: new Date(1_700_092_800_000).toISOString(),
      },
      bars: [],
      as_of: new Date(1_700_092_800_000).toISOString(),
      delay_class: "eod",
      currency: expectedCurrency,
      source_id: FIXTURE_SOURCE_ID,
      adjustment_basis: "split_and_div_adjusted",
    },
  });

  const polygon = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: makeRouteFetcher({
      [SNAPSHOT_PATH]: aaplSnapshotPayload({
        price: expectedPrice,
        prevClose: expectedPrevClose,
      }),
    }),
    resolveListing: async () => aaplCtx,
  });

  const fromFixture = await priceSummaryConsumer(fixture, aaplListing);
  const fromPolygon = await priceSummaryConsumer(polygon, aaplListing);

  // The seam guarantee: swapping the adapter must not change what the
  // consumer observes for equivalent underlying market state.
  assert.deepEqual(fromFixture, fromPolygon);
});

test("normalized records carry the spec §6.2.1 required metadata fields", async () => {
  const polygon = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async (path: string) => {
      if (path === SNAPSHOT_PATH) {
        return aaplSnapshotPayload({ price: 1, prevClose: 0.99 });
      }
      if (path.startsWith("/v2/aggs/ticker/AAPL/")) {
        return {
          adjusted: true,
          resultsCount: 1,
          results: [{ t: 1_700_006_400_000, o: 1, h: 1, l: 1, c: 1, v: 1 }],
        };
      }
      throw new Error(`unexpected fetch: ${path}`);
    },
    resolveListing: async () => aaplCtx,
  });

  const quoteOutcome = await polygon.getQuote({ listing: aaplListing });
  assert.equal(isAvailable(quoteOutcome), true);
  if (!isAvailable(quoteOutcome)) return;
  const quote = quoteOutcome.data;
  for (const key of ["as_of", "delay_class", "currency", "source_id"] as const) {
    assert.ok(quote[key] !== undefined && quote[key] !== "", `quote missing ${key}`);
  }

  const barsOutcome = await polygon.getBars({
    listing: aaplListing,
    interval: "1d",
    range: {
      start: new Date(1_700_006_400_000).toISOString(),
      end: new Date(1_700_092_800_000).toISOString(),
    },
  });
  assert.equal(isAvailable(barsOutcome), true);
  if (!isAvailable(barsOutcome)) return;
  const bars = barsOutcome.data;
  for (const key of [
    "as_of",
    "delay_class",
    "currency",
    "source_id",
    "adjustment_basis",
  ] as const) {
    assert.ok(bars[key] !== undefined && bars[key] !== "", `bars missing ${key}`);
  }
});

test("adapter exposes its provider name and source_id for provenance routing", () => {
  const polygon = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async () => ({}),
    resolveListing: async () => aaplCtx,
  });

  assert.equal(polygon.providerName, "polygon");
  assert.equal(polygon.sourceId, POLYGON_SOURCE_ID);
});

test("seam guarantee: a provider 5xx never leaks raw provider error shapes to consumers", async () => {
  // The "broken provider" raises an error shaped exactly like a vendor JSON
  // body. The consumer must NEVER observe those vendor field names — only
  // the normalized envelope.
  const polygon = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async () => {
      throw new PolygonFetchError(
        503,
        JSON.stringify({ request_id: "abc", error: { ticker: "X", lastTrade: null } }),
      );
    },
    resolveListing: async () => aaplCtx,
    clock: () => new Date("2026-04-22T20:00:00.000Z"),
  });

  const summary = await priceSummaryConsumer(polygon, aaplListing);
  // Consumer's observable surface: either a clean summary, or a single
  // unavailable signal. No raw vendor fields, no leaked error objects.
  assert.deepEqual(summary, { unavailable: true });
});
