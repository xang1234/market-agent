import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import {
  createMarketServer,
  type MarketServerDeps,
} from "../src/http.ts";
import {
  type CommodityCurveResponse,
  type CommodityInventoryResponse,
  type CommodityLatestResponse,
  type CommoditySeriesResponse,
  type CommoditySpreadsResponse,
} from "../src/commodity-market-adapter.ts";
import { createPolygonAdapter } from "../src/adapters/polygon.ts";
import {
  createInMemoryListingRepository,
  listingResolverFromRepository,
} from "../src/listings.ts";
import {
  COPPER_COMMODITY_ID,
  COPPER_CONTRACT_ID,
  COPPER_CURVE_ID,
  createDevCommodityMarketDataAdapter,
} from "../src/dev-commodity-market-adapter.ts";
import {
  createDevPolygonFetcher,
  DEV_LISTINGS,
  DEV_POLYGON_SOURCE_ID,
} from "../src/dev-fixtures.ts";

const FIXED_NOW = new Date("2026-05-31T00:00:00.000Z");

function buildDeps(overrides: Partial<MarketServerDeps> = {}): MarketServerDeps {
  const listings = createInMemoryListingRepository(DEV_LISTINGS);
  const adapter = createPolygonAdapter({
    sourceId: DEV_POLYGON_SOURCE_ID,
    delayClass: "delayed_15m",
    fetcher: createDevPolygonFetcher({ clock: () => FIXED_NOW }),
    resolveListing: listingResolverFromRepository(listings),
  });
  return {
    adapter,
    listings,
    clock: () => FIXED_NOW,
    commodityAdapter: createDevCommodityMarketDataAdapter({ clock: () => FIXED_NOW }),
    ...overrides,
  };
}

async function startServer(t: TestContext, deps: MarketServerDeps = buildDeps()): Promise<string> {
  const server = createMarketServer(deps);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test("createMarketServer fails fast without the commodity market adapter", () => {
  const base = buildDeps();
  assert.throws(
    () => createMarketServer({
      adapter: base.adapter,
      listings: base.listings,
      clock: base.clock,
    } as MarketServerDeps),
    /commodity market adapter is required/,
  );
});

test("GET /v1/markets/latest returns a normalized commodity quote contract", async (t) => {
  const base = await startServer(t);
  const response = await fetch(`${base}/v1/markets/latest?subject_kind=contract&subject_id=${COPPER_CONTRACT_ID}`);
  assert.equal(response.status, 200);

  const body = await response.json() as CommodityLatestResponse;
  assert.equal(body.quote.subject_ref.kind, "contract");
  assert.equal(body.quote.subject_ref.id, COPPER_CONTRACT_ID);
  assert.equal(body.quote.currency, "USD");
  assert.equal(body.quote.grade, "Grade A copper cathode");
  assert.equal(body.quote.location, "LME warehouse");
  assert.equal(body.quote.delivery_month, "cash");
  assert.equal(body.quote.incoterm, "warehouse");
  assert.equal(body.source_freshness.delay_class, "real_time");
});

test("GET /v1/markets/series returns commodity series points with unit and currency", async (t) => {
  const base = await startServer(t);
  const response = await fetch(`${base}/v1/markets/series?subject_kind=contract&subject_id=${COPPER_CONTRACT_ID}`);
  assert.equal(response.status, 200);

  const body = await response.json() as CommoditySeriesResponse;
  assert.equal(body.subject_ref.kind, "contract");
  assert.equal(body.currency, "USD");
  assert.equal(body.unit, "t");
  assert.ok(body.points.length >= 2);
});

test("GET /v1/markets/curve and /spreads return normalized curve structure", async (t) => {
  const base = await startServer(t);
  const curveResponse = await fetch(`${base}/v1/markets/curve?curve_id=${COPPER_CURVE_ID}`);
  assert.equal(curveResponse.status, 200);
  const curve = await curveResponse.json() as CommodityCurveResponse;
  assert.deepEqual(curve.curve.points.map((point) => point.tenor), ["cash", "3M"]);

  const spreadsResponse = await fetch(`${base}/v1/markets/spreads?curve_id=${COPPER_CURVE_ID}`);
  assert.equal(spreadsResponse.status, 200);
  const spreads = await spreadsResponse.json() as CommoditySpreadsResponse;
  assert.equal(spreads.spreads[0].label, "cash / 3M");
});

test("GET /v1/markets/inventory returns inventory series for the commodity", async (t) => {
  const base = await startServer(t);
  const response = await fetch(`${base}/v1/markets/inventory?commodity_id=${COPPER_COMMODITY_ID}`);
  assert.equal(response.status, 200);

  const body = await response.json() as CommodityInventoryResponse;
  assert.equal(body.commodity_ref.kind, "commodity");
  assert.equal(body.commodity_ref.id, COPPER_COMMODITY_ID);
  assert.equal(body.unit, "t");
  assert.ok(body.points.length > 0);
});
