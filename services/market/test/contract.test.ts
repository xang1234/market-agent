import test from "node:test";
import assert from "node:assert/strict";
import {
  assertQuoteContract,
  normalizedQuote,
  type NormalizedQuote,
} from "../src/quote.ts";
import type { MarketDataAdapter } from "../src/adapter.ts";
import { createPolygonAdapter } from "../src/adapters/polygon.ts";
import type { ListingSubjectRef } from "../src/subject-ref.ts";

// Schema-assertion contract test (fra-cw0.1.2 verification clause). For each
// adapter the market service ships, retrieving a quote must produce a record
// that satisfies `assertQuoteContract`. New adapters added by future subtasks
// should append a row to the table below — that is the schema gate every
// adapter has to pass before consumers see its output.

const aaplListing: ListingSubjectRef = {
  kind: "listing",
  id: "11111111-1111-4111-a111-111111111111",
};
const POLYGON_SOURCE_ID = "00000000-0000-4000-a000-000000000001";
const FIXTURE_SOURCE_ID = "00000000-0000-4000-a000-0000000000ff";

const polygon: MarketDataAdapter = createPolygonAdapter({
  sourceId: POLYGON_SOURCE_ID,
  fetcher: async (path: string) => {
    if (path === "/v2/snapshot/locale/us/markets/stocks/tickers/AAPL") {
      return {
        status: "OK",
        ticker: {
          lastTrade: { p: 187.42, t: 1_700_000_000_000_000_000 },
          day: { c: 187.42 },
          prevDay: { c: 185.0 },
          market_status: "open",
        },
      };
    }
    throw new Error(`unexpected fetch: ${path}`);
  },
  resolveListing: async () => ({ ticker: "AAPL", mic: "XNAS", currency: "USD" }),
});

function fixtureAdapter(quote: NormalizedQuote): MarketDataAdapter {
  return {
    providerName: "fixture",
    sourceId: FIXTURE_SOURCE_ID,
    async getQuote() {
      return quote;
    },
    async getBars() {
      throw new Error("fixture: bars not exercised in this contract test");
    },
  };
}

const fixtureQuote = normalizedQuote({
  listing: aaplListing,
  price: 187.42,
  prev_close: 185.0,
  session_state: "regular",
  as_of: "2026-04-22T15:30:00.000Z",
  delay_class: "real_time",
  currency: "USD",
  source_id: FIXTURE_SOURCE_ID,
});

const adapters: Array<[string, MarketDataAdapter]> = [
  ["polygon", polygon],
  ["fixture", fixtureAdapter(fixtureQuote)],
];

for (const [name, adapter] of adapters) {
  test(`adapter ${name}: getQuote output satisfies the spec §6.2.1 quote contract`, async () => {
    const quote = await adapter.getQuote({ listing: aaplListing });

    // Schema assertion: the bead's verification clause.
    assert.doesNotThrow(() => assertQuoteContract(quote));

    // Required metadata fields named in the bead description.
    assert.equal(typeof quote.as_of, "string");
    assert.notEqual(quote.as_of, "");
    assert.equal(typeof quote.delay_class, "string");
    assert.equal(typeof quote.currency, "string");
    assert.equal(typeof quote.source_id, "string");

    // Identity carried straight through.
    assert.equal(quote.listing.kind, "listing");
    assert.equal(quote.listing.id, aaplListing.id);

    // Move math computed and consistent.
    assert.equal(quote.change_abs, quote.price - quote.prev_close);
    assert.equal(quote.change_pct, (quote.price - quote.prev_close) / quote.prev_close);
  });

  test(`adapter ${name}: source_id matches the adapter's declared sourceId`, async () => {
    const quote = await adapter.getQuote({ listing: aaplListing });
    assert.equal(quote.source_id, adapter.sourceId);
  });
}

test("contract test detects an adapter that emits a non-conformant quote", async () => {
  // A deliberately-broken adapter that bypasses the smart constructor and
  // returns an object missing required metadata. This proves the contract
  // gate would catch a regression in any future adapter.
  const brokenAdapter: MarketDataAdapter = {
    providerName: "broken",
    sourceId: FIXTURE_SOURCE_ID,
    async getQuote() {
      return {
        listing: aaplListing,
        price: 100,
        prev_close: 99,
        change_abs: 1,
        change_pct: 1 / 99,
        session_state: "regular",
        as_of: "2026-04-22T15:30:00.000Z",
        delay_class: "real_time",
        currency: "USD",
        // source_id deliberately omitted.
      } as unknown as NormalizedQuote;
    },
    async getBars() {
      throw new Error("not used");
    },
  };

  const q = await brokenAdapter.getQuote({ listing: aaplListing });
  assert.throws(() => assertQuoteContract(q), /source_id/);
});
