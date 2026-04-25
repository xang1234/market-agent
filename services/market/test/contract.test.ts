import test from "node:test";
import assert from "node:assert/strict";
import {
  assertQuoteContract,
  normalizedQuote,
  quoteMove,
  type NormalizedQuote,
} from "../src/quote.ts";
import {
  assertBarsContract,
  normalizedBars,
  type NormalizedBars,
} from "../src/bar.ts";
import type { MarketDataAdapter } from "../src/adapter.ts";
import { createPolygonAdapter } from "../src/adapters/polygon.ts";
import {
  aaplAggsPath,
  aaplAggsPayload,
  aaplBarRange,
  aaplCtx,
  aaplListing,
  aaplSnapshotPayload,
  FIXTURE_SOURCE_ID,
  makeRouteFetcher,
  POLYGON_DELAY_CLASS,
  POLYGON_SOURCE_ID,
  SNAPSHOT_PATH,
} from "./fixtures.ts";

function fixtureAdapter(records: {
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

const fixtureBars = normalizedBars({
  listing: aaplListing,
  interval: "1d",
  range: aaplBarRange,
  bars: [
    {
      ts: aaplBarRange.start,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10_000,
    },
  ],
  as_of: aaplBarRange.start,
  delay_class: "eod",
  currency: "USD",
  source_id: FIXTURE_SOURCE_ID,
  adjustment_basis: "split_and_div_adjusted",
});

function polygonAdapter(opts: { adjusted: boolean }): MarketDataAdapter {
  return createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: makeRouteFetcher({
      [SNAPSHOT_PATH]: aaplSnapshotPayload(),
      [aaplAggsPath()]: aaplAggsPayload({ adjusted: opts.adjusted }),
    }),
    resolveListing: async () => aaplCtx,
  });
}

const adapters: Array<[string, MarketDataAdapter]> = [
  ["polygon", polygonAdapter({ adjusted: true })],
  ["fixture", fixtureAdapter({ quote: fixtureQuote, bars: fixtureBars })],
];

for (const [name, adapter] of adapters) {
  test(`adapter ${name}: getQuote output satisfies the spec §6.2.1 quote contract`, async () => {
    const quote = await adapter.getQuote({ listing: aaplListing });

    assert.doesNotThrow(() => assertQuoteContract(quote));

    for (const key of ["as_of", "delay_class", "currency", "source_id"] as const) {
      assert.equal(typeof quote[key], "string");
      assert.notEqual(quote[key], "");
    }

    assert.equal(quote.listing.kind, "listing");
    assert.equal(quote.listing.id, aaplListing.id);

    const move = quoteMove(quote);
    assert.equal(move.change_abs, quote.price - quote.prev_close);
    assert.equal(move.change_pct, (quote.price - quote.prev_close) / quote.prev_close);
  });

  test(`adapter ${name}: getBars output satisfies the spec §6.2.1 bar contract`, async () => {
    const bars = await adapter.getBars({
      listing: aaplListing,
      interval: "1d",
      range: aaplBarRange,
    });

    assert.doesNotThrow(() => assertBarsContract(bars));

    for (const key of [
      "as_of",
      "delay_class",
      "currency",
      "source_id",
      "adjustment_basis",
    ] as const) {
      assert.equal(typeof bars[key], "string");
      assert.notEqual(bars[key], "");
    }

    assert.equal(bars.listing.kind, "listing");
    assert.equal(bars.listing.id, aaplListing.id);
    assert.deepEqual(bars.range, aaplBarRange);
    assert.equal(bars.interval, "1d");
  });

  test(`adapter ${name}: source_id matches the adapter's declared sourceId`, async () => {
    const quote = await adapter.getQuote({ listing: aaplListing });
    assert.equal(quote.source_id, adapter.sourceId);
  });
}

// Bead verification clause: explicit adjusted-vs-unadjusted gate.
for (const adjusted of [true, false]) {
  test(`bar contract gate accepts both adjusted (${adjusted}) and unadjusted polygon responses`, async () => {
    const adapter = polygonAdapter({ adjusted });
    const bars = await adapter.getBars({
      listing: aaplListing,
      interval: "1d",
      range: aaplBarRange,
    });
    assert.doesNotThrow(() => assertBarsContract(bars));
    assert.equal(
      bars.adjustment_basis,
      adjusted ? "split_and_div_adjusted" : "unadjusted",
    );
  });
}

test("contract test detects an adapter that emits a non-conformant quote", async () => {
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

test("contract test detects an adapter that emits non-conformant bars", async () => {
  const brokenAdapter: MarketDataAdapter = {
    providerName: "broken",
    sourceId: FIXTURE_SOURCE_ID,
    async getQuote() {
      throw new Error("not used");
    },
    async getBars() {
      return {
        listing: aaplListing,
        interval: "1d",
        range: aaplBarRange,
        bars: [
          {
            ts: aaplBarRange.start,
            open: 100,
            high: 101,
            low: 99,
            close: 100.5,
            volume: 10_000,
          },
        ],
        as_of: aaplBarRange.start,
        delay_class: "eod",
        currency: "USD",
        source_id: FIXTURE_SOURCE_ID,
        // adjustment_basis deliberately omitted.
      } as unknown as NormalizedBars;
    },
  };

  const result = await brokenAdapter.getBars({
    listing: aaplListing,
    interval: "1d",
    range: aaplBarRange,
  });
  assert.throws(() => assertBarsContract(result), /adjustment_basis/);
});
