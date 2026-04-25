import test from "node:test";
import assert from "node:assert/strict";
import type {
  MarketDataAdapter,
  NormalizedBars,
  NormalizedQuote,
} from "../src/adapter.ts";
import { normalizedQuote } from "../src/quote.ts";
import { createPolygonAdapter } from "../src/adapters/polygon.ts";
import type { ListingSubjectRef } from "../src/subject-ref.ts";

// A consumer is anything that takes a MarketDataAdapter and produces a result
// purely from normalized fields. The bead's verification clause is "Swap
// adapter fixture; consumers unchanged" — so this consumer must produce the
// same output for any adapter that returns equivalent normalized records,
// regardless of which provider (or test fixture) is behind it.
async function priceSummaryConsumer(
  adapter: MarketDataAdapter,
  listing: ListingSubjectRef,
): Promise<{ price: number; currency: string; delay_class: string }> {
  const quote = await adapter.getQuote({ listing });
  return {
    price: quote.price,
    currency: quote.currency,
    delay_class: quote.delay_class,
  };
}

const aaplListing: ListingSubjectRef = {
  kind: "listing",
  id: "11111111-1111-4111-a111-111111111111",
};

const POLYGON_SOURCE_ID = "00000000-0000-4000-a000-000000000001";
const FIXTURE_SOURCE_ID = "00000000-0000-4000-a000-0000000000ff";

// Hand-rolled fixture adapter: returns canned normalized records directly,
// proving the interface itself is sufficient — the consumer never sees vendor
// types from any specific provider.
function createFixtureAdapter(records: {
  quote: NormalizedQuote;
  bars: NormalizedBars;
}): MarketDataAdapter {
  return {
    providerName: "fixture",
    sourceId: FIXTURE_SOURCE_ID,
    async getQuote() {
      return records.quote;
    },
    async getBars() {
      return records.bars;
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
      delay_class: "real_time",
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
    fetcher: async (path: string) => {
      assert.equal(path, "/v2/snapshot/locale/us/markets/stocks/tickers/AAPL");
      return {
        status: "OK",
        ticker: {
          lastTrade: { p: expectedPrice, t: 1_700_000_000_000_000_000 },
          prevDay: { c: expectedPrevClose },
          market_status: "open",
        },
      };
    },
    resolveListing: async () => ({ ticker: "AAPL", mic: "XNAS", currency: expectedCurrency }),
  });

  const fromFixture = await priceSummaryConsumer(fixture, aaplListing);
  const fromPolygon = await priceSummaryConsumer(polygon, aaplListing);

  // The whole point of the seam: swapping the adapter must not change what the
  // consumer observes for equivalent underlying market state.
  assert.deepEqual(fromFixture, fromPolygon);
});

test("normalized records carry the spec §6.2.1 required metadata fields", async () => {
  const polygon = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    fetcher: async (path: string) => {
      if (path === "/v2/snapshot/locale/us/markets/stocks/tickers/AAPL") {
        return {
          status: "OK",
          ticker: {
            lastTrade: { p: 1, t: 1_700_000_000_000_000_000 },
            prevDay: { c: 0.99 },
            market_status: "open",
          },
        };
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
    resolveListing: async () => ({ ticker: "AAPL", mic: "XNAS", currency: "USD" }),
  });

  const quote = await polygon.getQuote({ listing: aaplListing });
  for (const key of ["as_of", "delay_class", "currency", "source_id"] as const) {
    assert.ok(quote[key] !== undefined && quote[key] !== "", `quote missing ${key}`);
  }

  const bars = await polygon.getBars({
    listing: aaplListing,
    interval: "1d",
    range: {
      start: new Date(1_700_006_400_000).toISOString(),
      end: new Date(1_700_092_800_000).toISOString(),
    },
  });
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
    fetcher: async () => ({}),
    resolveListing: async () => ({ ticker: "AAPL", mic: "XNAS", currency: "USD" }),
  });

  assert.equal(polygon.providerName, "polygon");
  assert.equal(polygon.sourceId, POLYGON_SOURCE_ID);
});
