import assert from "node:assert/strict";
import test from "node:test";

import { FROZEN_AS_OF, hydrateYtdBars, marketHydrationOrigin, turnNow } from "../src/ytd-hydration.ts";
import { GOLDEN_AS_OF } from "./golden/dataset.ts";

const NY = "America/New_York";
const LISTINGS = [
  { id: "62000000-0000-4000-8000-000000000001", timeZone: NY },
  { id: "62000000-0000-4000-8000-000000000002", timeZone: NY },
];
const NOW = "2026-09-01T00:00:00.000Z"; // 20:00 New York on Aug 31, after the close
const FULL = [{ ts: "2025-12-31T05:00:00.000Z", close: 100 }, { ts: "2026-08-31T04:00:00.000Z", close: 120 }];

const STALE = [{ ts: "2025-12-31T05:00:00.000Z", close: 100 }, { ts: "2026-05-29T04:00:00.000Z", close: 110 }];

// A market answering each basis with, per listing, a full YTD window, one that
// stopped in May, an "available" envelope with no bars, unavailable, or
// unavailable for now (a rate limit).
function fakeMarket(answers: Record<string, ReadonlyArray<"full" | "stale" | "empty" | "unavailable" | "rate_limited" | "refused">>) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(url), body });
    const results = (body.subject_refs as Array<{ id: string }>).map((ref, index) => {
      const answer = answers[String(body.basis)]?.[index] ?? "unavailable";
      return {
        listing: { kind: "listing", id: ref.id },
        outcome: answer === "unavailable"
          ? { outcome: "unavailable", reason: "missing_coverage", retryable: false }
          : answer === "rate_limited"
          ? { outcome: "unavailable", reason: "rate_limited", retryable: true }
          : answer === "refused"
          ? { outcome: "unavailable", reason: "provider_error", retryable: false }
          : { outcome: "available", data: { bars: answer === "full" ? FULL : answer === "stale" ? STALE : [] } },
      };
    });
    return new Response(JSON.stringify({ results }), { status: 200 });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

// Each listing's outcome: its status, or a failure's cause.
async function read(fetchImpl: typeof fetch): Promise<string[]> {
  const outcomes = await hydrateYtdBars({ origin: "http://market.test", listings: LISTINGS, now: NOW, fetchImpl });
  return LISTINGS.map((listing) => {
    const outcome = outcomes.get(listing.id)!;
    return outcome.status === "failed" ? outcome.cause.message : outcome.status;
  });
}
const marketFailed = (listing: { id: string }, reason: string) => `the market could not answer for ${listing.id} (${reason}) just now`;

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

test("a listing the market has no bars for on any basis reads empty, and one with bars reads stored (#665)", async () => {
  const both = fakeMarket({ split_adjusted: ["full", "full"] });
  assert.deepEqual(await read(both.fetchImpl), ["stored", "stored"]);
  const one = fakeMarket({ split_adjusted: ["full", "empty"], split_and_div_adjusted: ["full", "unavailable"] });
  assert.deepEqual(await read(one.fetchImpl), ["stored", "empty"]);
  // A window that is not current still stored bars.
  const stale = fakeMarket({ split_adjusted: ["stale", "stale"], split_and_div_adjusted: ["unavailable", "unavailable"] });
  assert.deepEqual(await read(stale.fetchImpl), ["stored", "stored"]);
  // The split-adjusted answer says so: a dividend-adjusted fallback that failed changes nothing.
  const fallback = fakeMarket({ split_adjusted: ["full", "empty"], split_and_div_adjusted: ["full", "refused"] });
  assert.deepEqual(await read(fallback.fetchImpl), ["stored", "empty"]);
  const uncovered = fakeMarket({ split_adjusted: ["full", "unavailable"], split_and_div_adjusted: ["full", "rate_limited"] });
  assert.deepEqual(await read(uncovered.fetchImpl), ["stored", "empty"]);
});

test("a listing the market failed for reads failed with its cause, so the step reads failed and is retried, whether or not it may retry (#665)", async () => {
  // No dividend-adjusted coverage (Polygon never serves that basis) says nothing about the listing's bars.
  const limited = fakeMarket({ split_adjusted: ["full", "rate_limited"], split_and_div_adjusted: ["full", "unavailable"] });
  assert.deepEqual(await read(limited.fetchImpl), ["stored", marketFailed(LISTINGS[1], "rate_limited")]);
  // A refused request (a bad key, a malformed answer) is no answer about the listing's bars either.
  const refused = fakeMarket({ split_adjusted: ["full", "refused"], split_and_div_adjusted: ["full", "unavailable"] });
  assert.deepEqual(await read(refused.fetchImpl), ["stored", marketFailed(LISTINGS[1], "provider_error")]);
});

test("a listing the market answered with no bars reads empty beside one it failed for, so its hold is kept (#689)", async () => {
  const mixed = fakeMarket({ split_adjusted: ["empty", "rate_limited"], split_and_div_adjusted: ["unavailable", "unavailable"] });
  assert.deepEqual(await read(mixed.fetchImpl), ["empty", marketFailed(LISTINGS[1], "rate_limited")]);
});

test("a refused or rate-limited dividend-adjusted fallback request changes nothing, as its outcome would not (#689)", async () => {
  for (const status of [500, 429]) {
    const split = fakeMarket({ split_adjusted: ["full", "unavailable"] });
    const fetchImpl = (async (url: URL | string, init?: RequestInit) =>
      (JSON.parse(String(init?.body)) as { basis: string }).basis === "split_adjusted" ? split.fetchImpl(url, init) : new Response("no", { status })) as typeof fetch;
    assert.deepEqual(await read(fetchImpl), ["stored", "empty"], String(status));
  }
});

test("a market failure reads failed for every listing, and a hung market rejects, so the turn's step reads failed", async (t) => {
  const failing = (async () => new Response("down", { status: 502 })) as typeof fetch;
  assert.deepEqual(await read(failing), LISTINGS.map((listing) => marketFailed(listing, "answered 502")));
  // A market that never answers is cut off by the timeout.
  const keepAlive = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(keepAlive));
  const hung = ((_url: URL | string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
  await assert.rejects(hydrateYtdBars({ origin: "http://market.test", listings: LISTINGS, now: NOW, fetchImpl: hung, timeoutMs: 20 }), { name: "TimeoutError" });
});

test("frozen data modes answer at the golden dataset's cutoff, whatever the year; live modes at the wall clock (#259)", () => {
  assert.equal(FROZEN_AS_OF, GOLDEN_AS_OF);
  assert.equal(turnNow({ DEV_NO_KEYS: "true" }), GOLDEN_AS_OF);
  assert.equal(turnNow({ DEV_NO_KEYS: "traces" }), GOLDEN_AS_OF);
  assert.equal(turnNow({ DEV_MODE: "analyst" }), GOLDEN_AS_OF);
  for (const env of [{}, { DEV_MODE: "data" }]) {
    const now = Date.parse(turnNow(env));
    assert.ok(Math.abs(now - Date.now()) < 5_000, JSON.stringify(env));
  }
});
