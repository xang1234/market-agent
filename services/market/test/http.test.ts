import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createMarketServer, type GetQuoteResponse, type MarketServerDeps } from "../src/http.ts";
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

const FIXED_NOW = new Date("2026-04-22T15:30:00.000Z");

function buildDeps(): MarketServerDeps {
  const listings = createInMemoryListingRepository(DEV_LISTINGS);
  const adapter = createPolygonAdapter({
    sourceId: DEV_POLYGON_SOURCE_ID,
    delayClass: "delayed_15m",
    fetcher: createDevPolygonFetcher({ clock: () => FIXED_NOW }),
    resolveListing: listingResolverFromRepository(listings),
  });
  return { adapter, listings };
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
