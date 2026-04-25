import test from "node:test";
import assert from "node:assert/strict";
import { createPolygonAdapter, PolygonFetchError } from "../../src/adapters/polygon.ts";
import { quoteMove } from "../../src/quote.ts";
import {
  assertUnavailableContract,
  isAvailable,
  isUnavailable,
} from "../../src/availability.ts";
import {
  aaplBarRange,
  aaplCtx,
  aaplListing,
  aaplSnapshotPayload,
  makeRouteFetcher,
  POLYGON_DELAY_CLASS,
  POLYGON_SOURCE_ID,
  SNAPSHOT_PATH,
} from "../fixtures.ts";

const FIXED_NOW = "2026-04-22T20:00:00.000Z";
const fixedClock = () => new Date(FIXED_NOW);

test("polygon adapter normalizes a snapshot payload into a NormalizedQuote with move math", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: makeRouteFetcher({ [SNAPSHOT_PATH]: aaplSnapshotPayload({ marketStatus: null }) }),
    resolveListing: async () => aaplCtx,
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  const quote = outcome.data;

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

  const outcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  assert.equal(outcome.data.delay_class, "delayed_15m");
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

    const outcome = await adapter.getQuote({ listing: aaplListing });
    assert.equal(isAvailable(outcome), true);
    if (!isAvailable(outcome)) continue;
    assert.equal(outcome.data.session_state, expected, `timestamp=${timestamp}`);
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
    const outcome = await adapter.getQuote({ listing: aaplListing });
    assert.equal(isAvailable(outcome), true);
    if (!isAvailable(outcome)) continue;
    assert.equal(outcome.data.session_state, expected, `vendor market_status=${vendor}`);
  }
});

test("polygon adapter returns unavailable(provider_error) when prev_close is missing", async () => {
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
    clock: fixedClock,
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.doesNotThrow(() => assertUnavailableContract(outcome));
  assert.equal(outcome.reason, "provider_error");
  assert.equal(outcome.retryable, false, "malformed payload won't fix on retry");
  assert.equal(outcome.listing.id, aaplListing.id);
  assert.equal(outcome.source_id, POLYGON_SOURCE_ID);
  assert.equal(outcome.as_of, FIXED_NOW);
  assert.match(outcome.detail ?? "", /prevDay\.c missing/);
});

test("polygon adapter returns unavailable when last trade is malformed", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: makeRouteFetcher({
      [SNAPSHOT_PATH]: { status: "OK", ticker: { lastTrade: {}, prevDay: { c: 99 } } },
    }),
    resolveListing: async () => aaplCtx,
    clock: fixedClock,
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.equal(outcome.reason, "provider_error");
  assert.match(outcome.detail ?? "", /lastTrade missing price or timestamp/);
});

test("polygon adapter classifies a 503 from the fetcher as a retryable provider_error", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async () => {
      throw new PolygonFetchError(503, "503 Service Unavailable");
    },
    resolveListing: async () => aaplCtx,
    clock: fixedClock,
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.doesNotThrow(() => assertUnavailableContract(outcome));
  assert.equal(outcome.reason, "provider_error");
  assert.equal(outcome.retryable, true);
  assert.equal(outcome.source_id, POLYGON_SOURCE_ID);
  assert.equal(outcome.as_of, FIXED_NOW);
});

test("polygon adapter classifies a 404 from the fetcher as missing_coverage", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async () => {
      throw new PolygonFetchError(404, "ticker not found");
    },
    resolveListing: async () => aaplCtx,
    clock: fixedClock,
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.equal(outcome.reason, "missing_coverage");
  assert.equal(outcome.retryable, false, "404 won't resolve by retrying");
});

test("polygon adapter classifies a 429 from the fetcher as rate_limited", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async () => {
      throw new PolygonFetchError(429, "rate limit exceeded");
    },
    resolveListing: async () => aaplCtx,
    clock: fixedClock,
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.equal(outcome.reason, "rate_limited");
  assert.equal(outcome.retryable, true);
});

test("polygon adapter classifies a 401 from the fetcher as non-retryable provider_error", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async () => {
      throw new PolygonFetchError(401, "unauthorized");
    },
    resolveListing: async () => aaplCtx,
    clock: fixedClock,
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.equal(outcome.reason, "provider_error");
  assert.equal(outcome.retryable, false);
});

test("polygon adapter classifies a generic network error as retryable provider_error", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async () => {
      throw new Error("ECONNRESET: connection reset by peer");
    },
    resolveListing: async () => aaplCtx,
    clock: fixedClock,
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.equal(outcome.reason, "provider_error");
  assert.equal(outcome.retryable, true);
  assert.match(outcome.detail ?? "", /ECONNRESET/);
});

test("polygon adapter wraps resolveListing failures as unavailable too", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async () => {
      throw new Error("should not be reached");
    },
    resolveListing: async () => {
      throw new Error("listing context lookup failed");
    },
    clock: fixedClock,
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.equal(outcome.reason, "provider_error");
});

test("polygon adapter unavailable envelope never carries raw provider field names in detail", async () => {
  // Spec §6.2.1: raw provider error payloads must not leak. The detail string
  // is human-readable but must come from our classifier, not be a passthrough
  // of a vendor JSON blob.
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async () => {
      // Vendor-shaped error body — must not appear verbatim in the envelope.
      const vendorErr = JSON.stringify({
        request_id: "abc-123",
        error: { ticker: "unknown", lastTrade: null },
      });
      throw new PolygonFetchError(503, `polygon api: ${vendorErr}`);
    },
    resolveListing: async () => aaplCtx,
    clock: fixedClock,
  });

  const outcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  // The envelope itself must not surface vendor field names structurally.
  for (const banned of ["ticker", "lastTrade", "request_id", "results"]) {
    assert.equal(banned in outcome, false, `vendor field "${banned}" leaked into envelope`);
  }
});

test("polygon adapter throws (does NOT wrap) when caller passes a malformed bar range", async () => {
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

  // Pre-fetch validation rejects caller misuse before any network call.
  // Caller bugs (bad range) intentionally throw so they don't masquerade as
  // provider unavailability — that would mask real consumer errors.
  await assert.rejects(
    adapter.getBars({
      listing: aaplListing,
      interval: "1d",
      range: { start: "2026-04-22", end: "2026-04-23" },
    }),
    /ISO-8601/,
  );
  assert.equal(fetched, false, "no fetch should have been issued for a malformed range");

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

  const outcome = await adapter.getBars({
    listing: aaplListing,
    interval: "1d",
    range: {
      start: new Date(1_700_006_400_000).toISOString(),
      end: new Date(1_700_179_200_000).toISOString(),
    },
  });
  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  const bars = outcome.data;

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

  const outcome = await adapter.getBars({
    listing: aaplListing,
    interval: "1d",
    range: {
      start: new Date(1_700_006_400_000).toISOString(),
      end: new Date(1_700_179_200_000).toISOString(),
    },
  });

  assert.deepEqual(fetched, [firstPath, nextUrl]);
  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  assert.equal(outcome.data.bars.length, 2);
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

  const outcome = await adapter.getBars({
    listing: aaplListing,
    interval: "1d",
    range: {
      start: new Date(1_700_006_400_000).toISOString(),
      end: new Date(1_700_092_800_000).toISOString(),
    },
  });

  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  assert.equal(outcome.data.adjustment_basis, "unadjusted");
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

  const outcome = await adapter.getQuote({ listing: aaplListing });
  assert.equal(isAvailable(outcome), true);
  if (!isAvailable(outcome)) return;
  const quote = outcome.data;

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

test("polygon adapter classifies bar fetch failures (5xx) as unavailable", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async () => {
      throw new PolygonFetchError(502, "bad gateway");
    },
    resolveListing: async () => aaplCtx,
    clock: fixedClock,
  });

  const outcome = await adapter.getBars({
    listing: aaplListing,
    interval: "1d",
    range: aaplBarRange,
  });
  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.equal(outcome.reason, "provider_error");
  assert.equal(outcome.retryable, true);
});

test("polygon adapter classifies a response missing the adjusted flag as unavailable", async () => {
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: makeRouteFetcher({
      "/v2/aggs/ticker/AAPL/range/1/day/1700006400000/1700092800000?adjusted=true&sort=asc&limit=50000": {
        // adjusted flag deliberately omitted — we requested adjusted=true so
        // its absence means we can't classify the basis.
        resultsCount: 1,
        results: [{ t: 1_700_006_400_000, o: 1, h: 1, l: 1, c: 1, v: 1 }],
      },
    }),
    resolveListing: async () => aaplCtx,
    clock: fixedClock,
  });

  const outcome = await adapter.getBars({
    listing: aaplListing,
    interval: "1d",
    range: {
      start: new Date(1_700_006_400_000).toISOString(),
      end: new Date(1_700_092_800_000).toISOString(),
    },
  });
  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.equal(outcome.reason, "provider_error");
  assert.equal(outcome.retryable, false);
  assert.match(outcome.detail ?? "", /missing adjusted flag/);
});

test("polygon adapter classifies an inconsistent multi-page adjusted flag as unavailable", async () => {
  const firstPath = "/v2/aggs/ticker/AAPL/range/1/day/1700006400000/1700179200000?adjusted=true&sort=asc&limit=50000";
  const nextUrl = "https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/next?cursor=mismatch";
  const adapter = createPolygonAdapter({
    sourceId: POLYGON_SOURCE_ID,
    delayClass: POLYGON_DELAY_CLASS,
    fetcher: async (path) => {
      if (path === firstPath) {
        return {
          adjusted: true,
          next_url: nextUrl,
          results: [{ t: 1_700_006_400_000, o: 100, h: 101, l: 99, c: 100.5, v: 10_000 }],
        };
      }
      if (path === nextUrl) {
        return {
          adjusted: false,
          results: [{ t: 1_700_092_800_000, o: 100.5, h: 102, l: 100.4, c: 101.7, v: 12_000 }],
        };
      }
      throw new Error(`unexpected fetch: ${path}`);
    },
    resolveListing: async () => aaplCtx,
    clock: fixedClock,
  });

  const outcome = await adapter.getBars({
    listing: aaplListing,
    interval: "1d",
    range: {
      start: new Date(1_700_006_400_000).toISOString(),
      end: new Date(1_700_179_200_000).toISOString(),
    },
  });
  assert.equal(isUnavailable(outcome), true);
  if (!isUnavailable(outcome)) return;
  assert.equal(outcome.reason, "provider_error");
  assert.equal(outcome.retryable, false);
});
