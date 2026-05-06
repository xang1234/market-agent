import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  createMarketServer,
  type GetQuoteResponse,
  type GetCacheAuditResponse,
  type GetSeriesResponse,
  type MarketServerDeps,
} from "../src/http.ts";
import { createPolygonAdapter } from "../src/adapters/polygon.ts";
import {
  createInMemoryListingRepository,
  listingResolverFromRepository,
} from "../src/listings.ts";
import {
  createDevPolygonFetcher,
  DEV_LISTINGS,
  DEV_POLYGON_SOURCE_ID,
} from "../src/dev-fixtures.ts";
import type { NormalizedSeriesQuery } from "../src/series-query.ts";

const FIXED_NOW = new Date("2026-04-22T15:30:00.000Z");

function buildDeps(): MarketServerDeps {
  const listings = createInMemoryListingRepository(DEV_LISTINGS);
  const adapter = createPolygonAdapter({
    sourceId: DEV_POLYGON_SOURCE_ID,
    delayClass: "delayed_15m",
    fetcher: createDevPolygonFetcher({ clock: () => FIXED_NOW }),
    resolveListing: listingResolverFromRepository(listings),
  });
  return { adapter, listings, clock: () => FIXED_NOW };
}

async function startServer(t: TestContext, deps: MarketServerDeps): Promise<string> {
  const server = createMarketServer(deps);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const APPLE_LISTING_ID = DEV_LISTINGS[0].listing_id;

test("GET /healthz returns ok", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(`${url}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok", service: "market" });
});

test("GET /v1/market/quote returns a normalized quote with the live source_id", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/market/quote?subject_kind=listing&subject_id=${APPLE_LISTING_ID}`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as GetQuoteResponse;

  // Verification clause: the response carries the live source_id, not a stub.
  assert.equal(body.quote.source_id, DEV_POLYGON_SOURCE_ID);
  assert.notEqual(body.quote.source_id, "p1.1-stub");

  assert.equal(body.quote.listing.kind, "listing");
  assert.equal(body.quote.listing.id, APPLE_LISTING_ID);
  assert.equal(body.quote.currency, "USD");
  assert.equal(body.quote.delay_class, "delayed_15m");
  assert.ok(typeof body.quote.price === "number" && body.quote.price > 0);
  assert.equal(body.quote.price - body.quote.prev_close, body.quote.change_abs);

  assert.deepEqual(body.listing_context, {
    ticker: "AAPL",
    mic: "XNAS",
    timezone: "America/New_York",
  });
});

test("GET /v1/market/quote returns 404 for an unknown listing UUID", async (t) => {
  const url = await startServer(t, buildDeps());
  const unknown = "99999999-9999-4999-a999-999999999999";
  const res = await fetch(
    `${url}/v1/market/quote?subject_kind=listing&subject_id=${unknown}`,
  );
  assert.equal(res.status, 404);
});

test("GET /v1/market/quote returns 404 for a non-listing subject_kind", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/market/quote?subject_kind=issuer&subject_id=${APPLE_LISTING_ID}`,
  );
  assert.equal(res.status, 404, "issuer-kind quote requests are rejected as not-found routes");
});

test("GET /v1/market/quote returns 404 for a malformed UUID", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/market/quote?subject_kind=listing&subject_id=not-a-uuid`,
  );
  assert.equal(res.status, 404);
});

test("GET /v1/market/quote returns 502 when the upstream adapter throws", async (t) => {
  const listings = createInMemoryListingRepository(DEV_LISTINGS);
  const adapter = createPolygonAdapter({
    sourceId: DEV_POLYGON_SOURCE_ID,
    delayClass: "delayed_15m",
    fetcher: async () => {
      throw new Error("polygon: upstream 503");
    },
    resolveListing: listingResolverFromRepository(listings),
  });
  const url = await startServer(t, { adapter, listings });
  const res = await fetch(
    `${url}/v1/market/quote?subject_kind=listing&subject_id=${APPLE_LISTING_ID}`,
  );
  assert.equal(res.status, 502);
  const body = (await res.json()) as {
    error: string;
    unavailable: { outcome: string; reason: string; retryable: boolean };
  };
  assert.equal(body.error, "market quote unavailable");
  assert.equal(body.unavailable.outcome, "unavailable");
  assert.equal(body.unavailable.reason, "provider_error");
  assert.equal(body.unavailable.retryable, true);
});

test("unknown routes return 404 without leaking implementation details", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(`${url}/v1/market/unknown`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "not found");
});

test("POST /v1/market/quote is not allowed (only GET is wired)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(
    `${url}/v1/market/quote?subject_kind=listing&subject_id=${APPLE_LISTING_ID}`,
    { method: "POST" },
  );
  assert.equal(res.status, 404);
});

test("response surfaces every listing in DEV_LISTINGS with its declared ticker", async (t) => {
  const url = await startServer(t, buildDeps());
  for (const listing of DEV_LISTINGS) {
    const res = await fetch(
      `${url}/v1/market/quote?subject_kind=listing&subject_id=${listing.listing_id}`,
    );
    assert.equal(res.status, 200, `expected 200 for ${listing.ticker}`);
    const body = (await res.json()) as GetQuoteResponse;
    assert.equal(body.listing_context.ticker, listing.ticker);
    assert.equal(body.quote.source_id, DEV_POLYGON_SOURCE_ID);
  }
});

// ---------------------------------------------------------------------------
// /v1/market/series
// ---------------------------------------------------------------------------

const SERIES_RANGE = {
  start: "2026-01-05T00:00:00.000Z",
  end: "2026-01-09T00:00:00.000Z",
};

function validSeriesQuery(overrides: Partial<NormalizedSeriesQuery> = {}): NormalizedSeriesQuery {
  return {
    subject_refs: [{ kind: "listing", id: APPLE_LISTING_ID }],
    range: SERIES_RANGE,
    interval: "1d",
    basis: "split_and_div_adjusted",
    normalization: "raw",
    ...overrides,
  };
}

async function postSeries(url: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return fetch(`${url}/v1/market/series`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

test("POST /v1/market/series returns per-listing bars and echoes the binding query", async (t) => {
  const url = await startServer(t, buildDeps());
  const query = validSeriesQuery();
  const res = await postSeries(url, query);

  assert.equal(res.status, 200);
  const body = (await res.json()) as GetSeriesResponse;

  // The query echo is what gives a snapshot consumer a single object to bind
  // against — without it, downstream code has to remember the original query.
  assert.deepEqual(body.query, query);

  assert.equal(body.results.length, 1);
  const entry = body.results[0];
  assert.equal(entry.listing.id, APPLE_LISTING_ID);
  assert.equal(entry.outcome.outcome, "available");
  if (entry.outcome.outcome !== "available") return;
  const bars = entry.outcome.data;
  assert.equal(bars.listing.id, APPLE_LISTING_ID);
  assert.equal(bars.interval, "1d");
  assert.equal(bars.adjustment_basis, "split_and_div_adjusted");
  assert.equal(bars.currency, "USD");
  assert.equal(bars.source_id, DEV_POLYGON_SOURCE_ID);
  assert.ok(bars.bars.length > 0, "expected at least one bar in the dev range");
});

test("POST /v1/market/series fans out to multiple listings independently", async (t) => {
  const url = await startServer(t, buildDeps());
  const msftId = DEV_LISTINGS[1].listing_id;
  const query = validSeriesQuery({
    subject_refs: [
      { kind: "listing", id: APPLE_LISTING_ID },
      { kind: "listing", id: msftId },
    ],
  });
  const res = await postSeries(url, query);

  assert.equal(res.status, 200);
  const body = (await res.json()) as GetSeriesResponse;
  assert.equal(body.results.length, 2);
  assert.equal(body.results[0].listing.id, APPLE_LISTING_ID);
  assert.equal(body.results[1].listing.id, msftId);
  for (const entry of body.results) {
    assert.equal(entry.outcome.outcome, "available");
  }
});

test("POST /v1/market/series surfaces missing_coverage for unknown listing without polluting siblings", async (t) => {
  const url = await startServer(t, buildDeps());
  const unknownId = "99999999-9999-4999-a999-999999999999";
  const query = validSeriesQuery({
    subject_refs: [
      { kind: "listing", id: APPLE_LISTING_ID },
      { kind: "listing", id: unknownId },
    ],
  });
  const res = await postSeries(url, query);

  assert.equal(res.status, 200);
  const body = (await res.json()) as GetSeriesResponse;
  assert.equal(body.results[0].outcome.outcome, "available");

  const missing = body.results[1].outcome;
  assert.equal(missing.outcome, "unavailable");
  if (missing.outcome !== "unavailable") return;
  assert.equal(missing.reason, "missing_coverage");
  assert.equal(missing.listing.id, unknownId);
  assert.equal(missing.retryable, false);
  assert.match(missing.detail ?? "", /listing not found/);
});

test("POST /v1/market/series rejects mismatched basis as missing_coverage rather than relabeling bars", async (t) => {
  const url = await startServer(t, buildDeps());
  // Polygon adapter only ever returns split_and_div_adjusted. Asking for any
  // other basis is the "never silently swap" case from the bead contract.
  const res = await postSeries(url, validSeriesQuery({ basis: "unadjusted" }));

  assert.equal(res.status, 200);
  const body = (await res.json()) as GetSeriesResponse;
  const outcome = body.results[0].outcome;
  assert.equal(outcome.outcome, "unavailable");
  if (outcome.outcome !== "unavailable") return;
  assert.equal(outcome.reason, "missing_coverage");
  assert.match(outcome.detail ?? "", /basis="unadjusted"/);
  assert.match(outcome.detail ?? "", /split_and_div_adjusted/);
});

test("POST /v1/market/series rejects unsupported normalization at the request layer (400)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postSeries(url, validSeriesQuery({ normalization: "pct_return" }));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /pct_return/);
  assert.match(body.error, /transform/);
});

test("POST /v1/market/series rejects a missing required field with a 400 naming the field", async (t) => {
  const url = await startServer(t, buildDeps());
  const incomplete = { ...validSeriesQuery(), basis: undefined };
  const res = await postSeries(url, incomplete);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /basis/);
});

test("POST /v1/market/series rejects a query with an empty subject_refs array", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postSeries(url, validSeriesQuery({ subject_refs: [] }));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /subject_refs/);
});

test("POST /v1/market/series rejects a non-listing subject ref kind", async (t) => {
  const url = await startServer(t, buildDeps());
  const issuerRef = { kind: "issuer", id: APPLE_LISTING_ID };
  const res = await postSeries(url, {
    ...validSeriesQuery(),
    subject_refs: [issuerRef],
  });
  assert.equal(res.status, 400);
});

test("POST /v1/market/series rejects malformed JSON with 400", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await postSeries(url, "{ not json");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /invalid JSON/i);
});

test("POST /v1/market/series rejects non-JSON content-type with 415", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(`${url}/v1/market/series`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify(validSeriesQuery()),
  });
  assert.equal(res.status, 415);
});

test("POST /v1/market/series rejects an empty body with 400", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(`${url}/v1/market/series`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  assert.equal(res.status, 400);
});

test("GET /v1/market/series is not allowed (only POST is wired)", async (t) => {
  const url = await startServer(t, buildDeps());
  const res = await fetch(`${url}/v1/market/series`);
  assert.equal(res.status, 404);
});

test("POST /v1/market/series surfaces adapter failures as per-listing unavailable, not a top-level 502", async (t) => {
  const listings = createInMemoryListingRepository(DEV_LISTINGS);
  const adapter = createPolygonAdapter({
    sourceId: DEV_POLYGON_SOURCE_ID,
    delayClass: "delayed_15m",
    fetcher: async () => {
      throw new Error("polygon: synthetic upstream failure");
    },
    resolveListing: listingResolverFromRepository(listings),
  });
  const url = await startServer(t, { adapter, listings, clock: () => FIXED_NOW });

  const res = await postSeries(url, validSeriesQuery());
  assert.equal(res.status, 200);
  const body = (await res.json()) as GetSeriesResponse;
  const outcome = body.results[0].outcome;
  assert.equal(outcome.outcome, "unavailable");
  if (outcome.outcome !== "unavailable") return;
  assert.equal(outcome.reason, "provider_error");
});

test("POST /v1/market/series does not cache retryable unavailable outcomes", async (t) => {
  const listings = createInMemoryListingRepository(DEV_LISTINGS);
  let getBarsCalls = 0;
  const adapter = {
    ...buildDeps().adapter,
    sourceId: DEV_POLYGON_SOURCE_ID,
    async getBars() {
      getBarsCalls += 1;
      throw new Error("polygon: synthetic upstream failure");
    },
  };
  const url = await startServer(t, { adapter, listings, clock: () => FIXED_NOW });
  const query = validSeriesQuery();

  assert.equal((await postSeries(url, query)).status, 200);
  assert.equal((await postSeries(url, query)).status, 200);

  const audit = await fetch(`${url}/v1/market/cache-audit`);
  assert.equal(audit.status, 200);
  const body = (await audit.json()) as GetCacheAuditResponse;
  assert.equal(getBarsCalls, 2);
  assert.equal(body.dashboard.misses, 2);
  assert.equal(body.dashboard.hits, 0);
});

test("GET /v1/market/cache-audit reports runtime series cache identity events", async (t) => {
  const url = await startServer(t, buildDeps());
  const series = await postSeries(url, validSeriesQuery());
  assert.equal(series.status, 200);

  const res = await fetch(`${url}/v1/market/cache-audit`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as GetCacheAuditResponse;

  assert.equal(body.dashboard.total, 1);
  assert.equal(body.dashboard.misses, 1);
  assert.equal(body.dashboard.byDimension.interval[0].value, "1d");
  assert.equal(body.dashboard.byDimension.basis[0].value, "split_and_div_adjusted");
});

test("GET /v1/market/cache-audit reports hits only when the series response cache is reused", async (t) => {
  const deps = buildDeps();
  let nowMs = FIXED_NOW.getTime();
  let getBarsCalls = 0;
  const adapter = {
    ...deps.adapter,
    getBars: async (...args: Parameters<typeof deps.adapter.getBars>) => {
      getBarsCalls += 1;
      return deps.adapter.getBars(...args);
    },
  };
  const url = await startServer(t, {
    ...deps,
    adapter,
    clock: () => {
      const now = new Date(nowMs);
      nowMs += 60_000;
      return now;
    },
  });
  const query = validSeriesQuery();

  assert.equal((await postSeries(url, query)).status, 200);
  assert.equal((await postSeries(url, query)).status, 200);

  const res = await fetch(`${url}/v1/market/cache-audit`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as GetCacheAuditResponse;
  assert.equal(getBarsCalls, 1);
  assert.equal(body.dashboard.total, 2);
  assert.equal(body.dashboard.misses, 1);
  assert.equal(body.dashboard.hits, 1);
});

test("GET /v1/market/cache-audit bounds retained runtime audit events", async (t) => {
  const url = await startServer(t, {
    ...buildDeps(),
    seriesCacheAuditMaxEvents: 2,
  });
  const query = validSeriesQuery();

  assert.equal((await postSeries(url, query)).status, 200);
  assert.equal((await postSeries(url, query)).status, 200);
  assert.equal((await postSeries(url, query)).status, 200);

  const res = await fetch(`${url}/v1/market/cache-audit`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as GetCacheAuditResponse;
  assert.equal(body.dashboard.total, 2);
  assert.equal(body.dashboard.hits, 2);
  assert.equal(body.dashboard.misses, 0);
});
