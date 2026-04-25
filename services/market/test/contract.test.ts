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
import {
  assertUnavailableContract,
  available,
  isAvailable,
  isUnavailable,
} from "../src/availability.ts";
import { createPolygonAdapter, PolygonFetchError } from "../src/adapters/polygon.ts";
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
      return available(records.quote);
    },
    async getBars() {
      return available(records.bars);
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
    const outcome = await adapter.getQuote({ listing: aaplListing });
    assert.equal(isAvailable(outcome), true);
    if (!isAvailable(outcome)) return;
    const quote = outcome.data;

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
    const outcome = await adapter.getBars({
      listing: aaplListing,
      interval: "1d",
      range: aaplBarRange,
    });
    assert.equal(isAvailable(outcome), true);
    if (!isAvailable(outcome)) return;
    const bars = outcome.data;

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
    const outcome = await adapter.getQuote({ listing: aaplListing });
    assert.equal(isAvailable(outcome), true);
    if (!isAvailable(outcome)) return;
    assert.equal(outcome.data.source_id, adapter.sourceId);
  });
}

// Bead verification clause: explicit adjusted-vs-unadjusted gate.
for (const adjusted of [true, false]) {
  test(`bar contract gate accepts both adjusted (${adjusted}) and unadjusted polygon responses`, async () => {
    const adapter = polygonAdapter({ adjusted });
    const outcome = await adapter.getBars({
      listing: aaplListing,
      interval: "1d",
      range: aaplBarRange,
    });
    assert.equal(isAvailable(outcome), true);
    if (!isAvailable(outcome)) return;
    const bars = outcome.data;
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
      return available({
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
      } as unknown as NormalizedQuote);
    },
    async getBars() {
      throw new Error("not used");
    },
  };

  const outcome = await brokenAdapter.getQuote({ listing: aaplListing });
  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  assert.throws(() => assertQuoteContract(outcome.data), /source_id/);
});

test("contract test detects an adapter that emits non-conformant bars", async () => {
  const brokenAdapter: MarketDataAdapter = {
    providerName: "broken",
    sourceId: FIXTURE_SOURCE_ID,
    async getQuote() {
      throw new Error("not used");
    },
    async getBars() {
      return available({
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
      } as unknown as NormalizedBars);
    },
  };

  const outcome = await brokenAdapter.getBars({
    listing: aaplListing,
    interval: "1d",
    range: aaplBarRange,
  });
  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  assert.throws(() => assertBarsContract(outcome.data), /adjustment_basis/);
});

// Bead verification clause: simulate provider 5xx; caller sees normalized envelope.
test("contract: a provider 5xx surfaces as a normalized unavailable envelope (not a raw error)", async () => {
  const fixedNow = "2026-04-22T20:00:00.000Z";
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async () => {
      throw new PolygonFetchError(503, "503 Service Unavailable");
    },
    resolveListing: async () => aaplCtx,
    clock: () => new Date(fixedNow),
  });

  const quoteOutcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isUnavailable(quoteOutcome), true);
  if (!isUnavailable(quoteOutcome)) return;
  assert.doesNotThrow(() => assertUnavailableContract(quoteOutcome));
  assert.equal(quoteOutcome.reason, "provider_error");
  assert.equal(quoteOutcome.retryable, true);

  const barsOutcome = await adapter.getBars({
    listing: aaplListing,
    interval: "1d",
    range: aaplBarRange,
  });
  assert.equal(isUnavailable(barsOutcome), true);
  if (!isUnavailable(barsOutcome)) return;
  assert.doesNotThrow(() => assertUnavailableContract(barsOutcome));
  assert.equal(barsOutcome.reason, "provider_error");
  assert.equal(barsOutcome.retryable, true);
});
