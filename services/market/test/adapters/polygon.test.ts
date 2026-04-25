import test from "node:test";
import assert from "node:assert/strict";
import { createPolygonAdapter, type PolygonFetcher } from "../../src/adapters/polygon.ts";
import type { ListingSubjectRef } from "../../src/subject-ref.ts";

const POLYGON_SOURCE_ID = "00000000-0000-4000-a000-000000000001";

const aaplListing: ListingSubjectRef = {
  kind: "listing",
  id: "11111111-1111-4111-a111-111111111111",
};

const aaplCtx = { ticker: "AAPL", mic: "XNAS", currency: "USD" };

const SNAPSHOT_PATH = "/v2/snapshot/locale/us/markets/stocks/tickers/AAPL";

function makeFetcher(routes: Record<string, unknown>): PolygonFetcher {
  return async (path: string) => {
    if (!(path in routes)) {
      throw new Error(`unexpected fetch: ${path}`);
    }
    return routes[path];
  };
}

test("polygon adapter normalizes a snapshot payload into a NormalizedQuote with move math", async () => {
  const fetcher = makeFetcher({
    [SNAPSHOT_PATH]: {
      status: "OK",
      ticker: {
        lastTrade: { p: 187.42, t: 1_700_000_000_000_000_000 }, // ns
        day: { c: 187.42 },
        prevDay: { c: 185.0 },
        market_status: "open",
      },
    },
  });

  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    fetcher,
    resolveListing: async () => aaplCtx,
  });

  const quote = await adapter.getQuote({ listing: aaplListing });

  assert.equal(quote.listing.id, aaplListing.id);
  assert.equal(quote.price, 187.42);
  assert.equal(quote.prev_close, 185.0);
  assert.ok(Math.abs(quote.change_abs - 2.42) < 1e-9);
  assert.ok(Math.abs(quote.change_pct - (2.42 / 185.0)) < 1e-12);
  assert.equal(quote.currency, "USD");
  assert.equal(quote.delay_class, "real_time");
  assert.equal(quote.session_state, "regular");
  assert.equal(quote.source_id, POLYGON_SOURCE_ID);
  assert.equal(quote.as_of, new Date(1_700_000_000_000).toISOString());
});

test("polygon adapter classifies DELAYED status as delayed_15m", async () => {
  const fetcher = makeFetcher({
    [SNAPSHOT_PATH]: {
      status: "DELAYED",
      ticker: {
        lastTrade: { p: 100, t: 1_700_000_000_000_000_000 },
        prevDay: { c: 99 },
        market_status: "open",
      },
    },
  });
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    fetcher,
    resolveListing: async () => aaplCtx,
  });

  const quote = await adapter.getQuote({ listing: aaplListing });
  assert.equal(quote.delay_class, "delayed_15m");
});

test("polygon adapter maps market_status values onto SessionState", async () => {
  const cases: Array<[string, "regular" | "pre_market" | "post_market" | "closed"]> = [
    ["open", "regular"],
    ["early_hours", "pre_market"],
    ["late_hours", "post_market"],
    ["extended-hours", "post_market"],
    ["closed", "closed"],
  ];
  for (const [vendor, expected] of cases) {
    const fetcher = makeFetcher({
      [SNAPSHOT_PATH]: {
        status: "OK",
        ticker: {
          lastTrade: { p: 100, t: 1_700_000_000_000_000_000 },
          prevDay: { c: 99 },
          market_status: vendor,
        },
      },
    });
    const adapter = createPolygonAdapter({
      sourceId: POLYGON_SOURCE_ID,
      fetcher,
      resolveListing: async () => aaplCtx,
    });
    const quote = await adapter.getQuote({ listing: aaplListing });
    assert.equal(quote.session_state, expected, `vendor market_status=${vendor}`);
  }
});

test("polygon adapter throws when prev_close is missing (cannot compute change)", async () => {
  const fetcher = makeFetcher({
    [SNAPSHOT_PATH]: {
      status: "OK",
      ticker: {
        lastTrade: { p: 100, t: 1_700_000_000_000_000_000 },
        prevDay: {},
      },
    },
  });
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    fetcher,
    resolveListing: async () => aaplCtx,
  });
  await assert.rejects(
    adapter.getQuote({ listing: aaplListing }),
    /prevDay\.c missing/,
  );
});

test("polygon adapter throws on a malformed last-trade snapshot", async () => {
  const fetcher = makeFetcher({
    [SNAPSHOT_PATH]: { status: "OK", ticker: { lastTrade: {}, prevDay: { c: 99 } } },
  });
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    fetcher,
    resolveListing: async () => aaplCtx,
  });

  await assert.rejects(
    adapter.getQuote({ listing: aaplListing }),
    /lastTrade missing price or timestamp/,
  );
});

test("polygon adapter normalizes aggs into NormalizedBars and reports adjusted basis", async () => {
  const fetcher = makeFetcher({
    "/v2/aggs/ticker/AAPL/range/1/day/1700006400000/1700179200000?adjusted=true": {
      adjusted: true,
      resultsCount: 2,
      results: [
        { t: 1_700_006_400_000, o: 100, h: 101, l: 99, c: 100.5, v: 10_000 },
        { t: 1_700_092_800_000, o: 100.5, h: 102, l: 100.4, c: 101.7, v: 12_000 },
      ],
    },
  });

  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    fetcher,
    resolveListing: async () => aaplCtx,
  });

  const bars = await adapter.getBars({
    listing: aaplListing,
    interval: "1d",
    range: {
      start: new Date(1_700_006_400_000).toISOString(),
      end: new Date(1_700_179_200_000).toISOString(),
    },
  });

  assert.equal(bars.bars.length, 2);
  assert.equal(bars.adjustment_basis, "split_and_div_adjusted");
  assert.equal(bars.currency, "USD");
  assert.equal(bars.source_id, POLYGON_SOURCE_ID);
  assert.equal(bars.bars[0].open, 100);
  assert.equal(bars.bars[1].close, 101.7);
});

test("polygon adapter reports unadjusted basis when provider response is unadjusted", async () => {
  const fetcher = makeFetcher({
    "/v2/aggs/ticker/AAPL/range/1/day/1700006400000/1700092800000?adjusted=true": {
      adjusted: false,
      resultsCount: 1,
      results: [{ t: 1_700_006_400_000, o: 1, h: 1, l: 1, c: 1, v: 1 }],
    },
  });

  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    fetcher,
    resolveListing: async () => aaplCtx,
  });

  const bars = await adapter.getBars({
    listing: aaplListing,
    interval: "1d",
    range: {
      start: new Date(1_700_006_400_000).toISOString(),
      end: new Date(1_700_092_800_000).toISOString(),
    },
  });

  assert.equal(bars.adjustment_basis, "unadjusted");
});

test("polygon adapter does not leak vendor field names into normalized quote output", async () => {
  const fetcher = makeFetcher({
    [SNAPSHOT_PATH]: {
      status: "OK",
      ticker: {
        lastTrade: { p: 187.42, t: 1_700_000_000_000_000_000 },
        prevDay: { c: 185.0 },
        market_status: "open",
      },
      // Extra vendor noise that must NOT bleed through.
      request_id: "abc-123",
      results_meta: { ratelimit_remaining: 4 },
    },
  });

  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    fetcher,
    resolveListing: async () => aaplCtx,
  });

  const quote = await adapter.getQuote({ listing: aaplListing });

  for (const banned of [
    "ticker",
    "lastTrade",
    "prevDay",
    "market_status",
    "p",
    "t",
    "request_id",
    "results",
    "results_meta",
    "status",
  ]) {
    assert.equal(banned in quote, false, `vendor field "${banned}" leaked into quote`);
  }
});
