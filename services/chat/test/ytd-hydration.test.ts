import assert from "node:assert/strict";
import test from "node:test";

import { hydrateYtdBars, marketHydrationOrigin } from "../src/ytd-hydration.ts";

const LISTINGS = [{ id: "62000000-0000-4000-8000-000000000001" }, { id: "62000000-0000-4000-8000-000000000002" }];
const NOW = "2026-09-01T00:00:00.000Z";

function fakeMarket(availableByBasis: Record<string, number>) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(url), body });
    const available = availableByBasis[String(body.basis)] ?? 0;
    const results = LISTINGS.map((_, index) => ({ outcome: { outcome: index < available ? "available" : "unavailable" } }));
    return new Response(JSON.stringify({ results }), { status: 200 });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

test("frozen data modes never fetch live prices; live mode uses the market service (#232)", () => {
  assert.equal(marketHydrationOrigin({ MARKET_ORIGIN: "http://127.0.0.1:4321" }), "http://127.0.0.1:4321");
  assert.equal(marketHydrationOrigin({ MARKET_ORIGIN: "http://127.0.0.1:4321", DEV_NO_KEYS: "true" }), null);
  assert.equal(marketHydrationOrigin({ MARKET_ORIGIN: "http://127.0.0.1:4321", DEV_MODE: "analyst" }), null);
  assert.equal(marketHydrationOrigin({}), null);
});

test("the YTD window is requested from before the prior year's last sessions, split-adjusted (#232)", async () => {
  const market = fakeMarket({ split_adjusted: 2 });
  await hydrateYtdBars({ origin: "http://market.test", listings: LISTINGS, now: NOW, fetchImpl: market.fetchImpl });
  assert.equal(market.requests.length, 1, "every company had a split-adjusted window");
  const [request] = market.requests;
  assert.equal(request.url, "http://market.test/v1/market/series");
  assert.deepEqual(request.body, {
    subject_refs: LISTINGS.map((listing) => ({ kind: "listing", id: listing.id })),
    range: { start: "2025-12-20T00:00:00.000Z", end: NOW },
    interval: "1d",
    basis: "split_adjusted",
    normalization: "raw",
  });
});

test("if any company lacks a split-adjusted window, all are fetched dividend-adjusted, so one basis can chart them", async () => {
  const market = fakeMarket({ split_adjusted: 1, split_and_div_adjusted: 2 });
  await hydrateYtdBars({ origin: "http://market.test", listings: LISTINGS, now: NOW, fetchImpl: market.fetchImpl });
  assert.deepEqual(market.requests.map((request) => request.body.basis), ["split_adjusted", "split_and_div_adjusted"]);
  assert.equal((market.requests[1].body.subject_refs as unknown[]).length, 2);
});

test("a market failure or a hung market never fails the turn", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const failing = (async () => new Response("down", { status: 502 })) as typeof fetch;
  await hydrateYtdBars({ origin: "http://market.test", listings: LISTINGS, now: NOW, fetchImpl: failing });
  // A market that never answers is cut off by the timeout.
  const keepAlive = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(keepAlive));
  const hung = ((_url: URL | string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
  await hydrateYtdBars({ origin: "http://market.test", listings: LISTINGS, now: NOW, fetchImpl: hung, timeoutMs: 20 });
  assert.equal(warn.mock.callCount(), 2);
});
