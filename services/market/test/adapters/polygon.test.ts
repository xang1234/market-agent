import test from "node:test";
import assert from "node:assert/strict";
import { createPolygonAdapter } from "../../src/adapters/polygon.ts";
import { quoteMove } from "../../src/quote.ts";
import {
  aaplCtx,
  aaplListing,
  aaplSnapshotPayload,
  makeRouteFetcher,
  POLYGON_DELAY_CLASS,
  POLYGON_SOURCE_ID,
  SNAPSHOT_PATH,
} from "../fixtures.ts";

test("polygon adapter normalizes a snapshot payload into a NormalizedQuote with move math", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: makeRouteFetcher({ [SNAPSHOT_PATH]: aaplSnapshotPayload({ marketStatus: null }) }),
    resolveListing: async () => aaplCtx,
  });

  const quote = await adapter.getQuote({ listing: aaplListing });

  assert.equal(quote.listing.id, aaplListing.id);
  assert.equal(quote.price, 187.42);
  assert.equal(quote.prev_close, 185.0);
  const move = quoteMove(quote);
  assert.ok(Math.abs(move.change_abs - 2.42) < 1e-9);
  assert.ok(Math.abs(move.change_pct - (2.42 / 185.0)) < 1e-12);
  assert.equal(quote.currency, "USD");
  assert.equal(quote.delay_class, POLYGON_DELAY_CLASS);
  assert.equal(quote.session_state, "regular");
  assert.equal(quote.source_id, POLYGON_SOURCE_ID);
  assert.equal(quote.as_of, "2026-04-22T14:00:00.000Z");
});

test("polygon adapter uses configured recency instead of response status", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: makeRouteFetcher({
      [SNAPSHOT_PATH]: aaplSnapshotPayload({ status: "OK", price: 100, prevClose: 99 }),
    }),
    resolveListing: async () => aaplCtx,
  });

  const quote = await adapter.getQuote({ listing: aaplListing });
  assert.equal(quote.delay_class, "delayed_15m");
});

test("polygon adapter derives session state from last trade timestamp when snapshot has no session field", async () => {
  const cases: Array<[string, "regular" | "pre_market" | "post_market" | "closed"]> = [
    ["2026-04-22T14:00:00.000Z", "regular"],
    ["2026-04-22T12:00:00.000Z", "pre_market"],
    ["2026-04-22T21:00:00.000Z", "post_market"],
    ["2026-04-23T01:30:00.000Z", "closed"],
    ["2026-04-25T14:00:00.000Z", "closed"],
  ];

  for (const [timestamp, expected] of cases) {
    const adapter = createPolygonAdapter({
      sourceId: POLYGON_SOURCE_ID,
      delayClass: POLYGON_DELAY_CLASS,
      fetcher: makeRouteFetcher({
        [SNAPSHOT_PATH]: aaplSnapshotPayload({
          price: 100,
          prevClose: 99,
          marketStatus: null,
          tNs: Date.parse(timestamp) * 1_000_000,
        }),
      }),
      resolveListing: async () => aaplCtx,
    });

    const quote = await adapter.getQuote({ listing: aaplListing });
    assert.equal(quote.session_state, expected, `timestamp=${timestamp}`);
  }
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
    const adapter = createPolygonAdapter({
      sourceId: POLYGON_SOURCE_ID,
      delayClass: POLYGON_DELAY_CLASS,
      fetcher: makeRouteFetcher({
        [SNAPSHOT_PATH]: aaplSnapshotPayload({ price: 100, prevClose: 99, marketStatus: vendor }),
      }),
      resolveListing: async () => aaplCtx,
    });
    const quote = await adapter.getQuote({ listing: aaplListing });
    assert.equal(quote.session_state, expected, `vendor market_status=${vendor}`);
  }
});

test("polygon adapter throws when prev_close is missing (cannot compute change)", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: makeRouteFetcher({
      [SNAPSHOT_PATH]: {
        status: "OK",
        ticker: {
          lastTrade: { p: 100, t: 1_700_000_000_000_000_000 },
          prevDay: {},
        },
      },
    }),
    resolveListing: async () => aaplCtx,
  });
  await assert.rejects(
    adapter.getQuote({ listing: aaplListing }),
    /prevDay\.c missing/,
  );
});

test("polygon adapter throws on a malformed last-trade snapshot", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: makeRouteFetcher({
      [SNAPSHOT_PATH]: { status: "OK", ticker: { lastTrade: {}, prevDay: { c: 99 } } },
    }),
    resolveListing: async () => aaplCtx,
  });

  await assert.rejects(
    adapter.getQuote({ listing: aaplListing }),
    /lastTrade missing price or timestamp/,
  );
});

test("polygon adapter rejects a malformed bar range pre-fetch (no wasted network call)", async () => {
  let fetched = false;
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async () => {
      fetched = true;
      return {};
    },
    resolveListing: async () => aaplCtx,
  });

  // "2026-04-22" is Date.parse-able (returns midnight UTC ms) but is NOT a
  // valid offset-bearing ISO-8601 timestamp. Pre-fetch validation must reject
  // it before any network call leaves the adapter.
  await assert.rejects(
    adapter.getBars({
      listing: aaplListing,
      interval: "1d",
      range: { start: "2026-04-22", end: "2026-04-23" },
    }),
    /ISO-8601/,
  );
  assert.equal(fetched, false, "no fetch should have been issued for a malformed range");

  // Range with start >= end must also be rejected pre-fetch.
  await assert.rejects(
    adapter.getBars({
      listing: aaplListing,
      interval: "1d",
      range: {
        start: "2026-04-22T00:00:00.000Z",
        end: "2026-04-22T00:00:00.000Z",
      },
    }),
    /start must be strictly before end/,
  );
  assert.equal(fetched, false, "no fetch should have been issued for a zero-width range");
});

test("polygon adapter normalizes aggs into NormalizedBars and reports adjusted basis", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: makeRouteFetcher({
      "/v2/aggs/ticker/AAPL/range/1/day/1700006400000/1700179200000?adjusted=true&sort=asc&limit=50000": {
        adjusted: true,
        resultsCount: 2,
        results: [
          { t: 1_700_006_400_000, o: 100, h: 101, l: 99, c: 100.5, v: 10_000 },
          { t: 1_700_092_800_000, o: 100.5, h: 102, l: 100.4, c: 101.7, v: 12_000 },
        ],
      },
    }),
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
  assert.equal(bars.delay_class, POLYGON_DELAY_CLASS);
  assert.equal(bars.currency, "USD");
  assert.equal(bars.source_id, POLYGON_SOURCE_ID);
  assert.equal(bars.bars[0].open, 100);
  assert.equal(bars.bars[1].close, 101.7);
});

test("polygon adapter follows aggregate next_url pages", async () => {
  const firstPath = "/v2/aggs/ticker/AAPL/range/1/day/1700006400000/1700179200000?adjusted=true&sort=asc&limit=50000";
  const nextUrl = "https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/next?cursor=abc";
  const fetched: string[] = [];
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async (path) => {
      fetched.push(path);
      if (path === firstPath) {
        return {
          adjusted: true,
          next_url: nextUrl,
          results: [{ t: 1_700_006_400_000, o: 100, h: 101, l: 99, c: 100.5, v: 10_000 }],
        };
      }
      if (path === nextUrl) {
        return {
          adjusted: true,
          results: [{ t: 1_700_092_800_000, o: 100.5, h: 102, l: 100.4, c: 101.7, v: 12_000 }],
        };
      }
      throw new Error(`unexpected fetch: ${path}`);
    },
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

  assert.deepEqual(fetched, [firstPath, nextUrl]);
  assert.equal(bars.bars.length, 2);
});

test("polygon adapter reports unadjusted basis when provider response is unadjusted", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: makeRouteFetcher({
      "/v2/aggs/ticker/AAPL/range/1/day/1700006400000/1700092800000?adjusted=true&sort=asc&limit=50000": {
        adjusted: false,
        resultsCount: 1,
        results: [{ t: 1_700_006_400_000, o: 1, h: 1, l: 1, c: 1, v: 1 }],
      },
    }),
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
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: makeRouteFetcher({
      [SNAPSHOT_PATH]: {
        ...(aaplSnapshotPayload() as object),
        request_id: "abc-123",
        results_meta: { ratelimit_remaining: 4 },
      },
    }),
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
