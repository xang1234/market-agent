import assert from "node:assert/strict";
import test from "node:test";

import { hydrateYtdBars, marketHydrationOrigin } from "../src/ytd-hydration.ts";

const NY = "America/New_York";
const LISTINGS = [
  { id: "62000000-0000-4000-8000-000000000001", timeZone: NY },
  { id: "62000000-0000-4000-8000-000000000002", timeZone: NY },
];
const NOW = "2026-09-01T00:00:00.000Z"; // 20:00 New York on Aug 31, after the close
const FULL = [{ ts: "2025-12-31T05:00:00.000Z", close: 100 }, { ts: "2026-08-31T04:00:00.000Z", close: 120 }];

const STALE = [{ ts: "2025-12-31T05:00:00.000Z", close: 100 }, { ts: "2026-05-29T04:00:00.000Z", close: 110 }];

// A market answering each basis with, per listing, a full YTD window, one that
// stopped in May, an "available" envelope with no bars, or unavailable.
function fakeMarket(answers: Record<string, ReadonlyArray<"full" | "stale" | "empty" | "unavailable">>) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(url), body });
    const results = (body.subject_refs as Array<{ id: string }>).map((ref, index) => {
      const answer = answers[String(body.basis)]?.[index] ?? "unavailable";
      return {
        listing: { kind: "listing", id: ref.id },
        outcome: answer === "unavailable"
          ? { outcome: "unavailable" }
          : { outcome: "available", data: { bars: answer === "full" ? FULL : answer === "stale" ? STALE : [] } },
      };
    });
    return new Response(JSON.stringify({ results }), { status: 200 });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

test("frozen data modes never fetch live prices; live mode uses the market service (#232)", () => {
  assert.equal(marketHydrationOrigin({ MARKET_ORIGIN: "http://127.0.0.1:4321" }), "http://127.0.0.1:4321");
  assert.equal(marketHydrationOrigin({ MARKET_ORIGIN: "http://127.0.0.1:4321", DEV_NO_KEYS: "true" }), null);
  assert.equal(marketHydrationOrigin({ MARKET_ORIGIN: "http://127.0.0.1:4321", DEV_MODE: "analyst" }), null);
  assert.equal(marketHydrationOrigin({}), null);
  // The chat profile's one-process app serves market on its own port, not MARKET_ORIGIN's.
  assert.equal(
    marketHydrationOrigin({ DEV_PROFILE: "chat", APP_PORT: "5173", MARKET_ORIGIN: "http://127.0.0.1:4321" }),
    "http://127.0.0.1:5173",
  );
  assert.equal(marketHydrationOrigin({ DEV_PROFILE: "chat", DEV_MODE: "analyst", APP_PORT: "5173" }), null);
  // A wildcard bind is reached over loopback; IPv6 hosts are bracketed.
  assert.equal(marketHydrationOrigin({ DEV_PROFILE: "chat", APP_HOST: "0.0.0.0", APP_PORT: "5173" }), "http://127.0.0.1:5173");
  assert.equal(marketHydrationOrigin({ DEV_PROFILE: "chat", APP_HOST: "::", APP_PORT: "5173" }), "http://[::1]:5173");
  assert.equal(marketHydrationOrigin({ DEV_PROFILE: "chat", APP_HOST: "::1", APP_PORT: "5173" }), "http://[::1]:5173");
  assert.doesNotThrow(() => new URL("/v1/market/series", marketHydrationOrigin({ DEV_PROFILE: "chat", APP_HOST: "::" })!));
});

test("the YTD window is requested from before the prior year's last sessions, split-adjusted (#232)", async () => {
  const market = fakeMarket({ split_adjusted: ["full", "full"] });
  await hydrateYtdBars({ origin: "http://market.test", listings: LISTINGS, now: NOW, fetchImpl: market.fetchImpl });
  assert.equal(market.requests.length, 1, "every company had a split-adjusted window");
  const [request] = market.requests;
  assert.equal(request.url, "http://market.test/v1/market/series");
  assert.deepEqual(request.body, {
    subject_refs: LISTINGS.map((listing) => ({ kind: "listing", id: listing.id })),
    // To the end of the last completed New York session (Aug 31 closed at 16:00).
    range: { start: "2025-12-20T00:00:00.000Z", end: "2026-09-01T04:00:00.000Z" },
    interval: "1d",
    basis: "split_adjusted",
    normalization: "raw",
  });
});

test("if any company lacks a split-adjusted window, all are fetched dividend-adjusted, so one basis can chart them", async () => {
  const market = fakeMarket({ split_adjusted: ["full", "unavailable"], split_and_div_adjusted: ["full", "full"] });
  await hydrateYtdBars({ origin: "http://market.test", listings: LISTINGS, now: NOW, fetchImpl: market.fetchImpl });
  assert.deepEqual(market.requests.map((request) => request.body.basis), ["split_adjusted", "split_and_div_adjusted"]);
  assert.equal((market.requests[1].body.subject_refs as unknown[]).length, 2);
});

test("an available answer without the bars a YTD window needs still falls back (#232)", async () => {
  // Polygon can answer "available" with no aggregates.
  const market = fakeMarket({ split_adjusted: ["full", "empty"], split_and_div_adjusted: ["full", "full"] });
  await hydrateYtdBars({ origin: "http://market.test", listings: LISTINGS, now: NOW, fetchImpl: market.fetchImpl });
  assert.deepEqual(market.requests.map((request) => request.body.basis), ["split_adjusted", "split_and_div_adjusted"]);
});

test("windows that agree but stop months short of the last completed session still fall back (#232)", async () => {
  const market = fakeMarket({ split_adjusted: ["stale", "stale"], split_and_div_adjusted: ["full", "full"] });
  await hydrateYtdBars({ origin: "http://market.test", listings: LISTINGS, now: NOW, fetchImpl: market.fetchImpl });
  assert.deepEqual(market.requests.map((request) => request.body.basis), ["split_adjusted", "split_and_div_adjusted"]);
});

test("before the close, the fetch stops at the last completed session, never the forming one (#232)", async () => {
  const market = fakeMarket({ split_adjusted: ["full", "full"] });
  await hydrateYtdBars({ origin: "http://market.test", listings: LISTINGS, now: "2026-08-31T15:00:00.000Z", fetchImpl: market.fetchImpl });
  // 11:00 New York on Aug 31: the range ends where Aug 31 begins.
  assert.equal((market.requests[0].body.range as { end: string }).end, "2026-08-31T04:00:00.000Z");
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
