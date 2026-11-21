import test from "node:test";
import assert from "node:assert/strict";
import { createDevPolygonFetcher, createSeededFixtureFallbackFetcher } from "../src/dev-fixtures.ts";

test("seeded fixture fallback fetcher preserves dev quotes when live Polygon rejects a seeded ticker", async () => {
  const liveCalls: string[] = [];
  const fallback = createSeededFixtureFallbackFetcher({
    primary: async (path) => {
      liveCalls.push(path);
      throw new Error("polygon: HTTP 403");
    },
    fallback: createDevPolygonFetcher({ clock: () => new Date("2026-05-08T12:00:00.000Z") }),
  });

  const payload = await fallback("/v2/snapshot/locale/us/markets/stocks/tickers/AAPL");

  assert.deepEqual(liveCalls, ["/v2/snapshot/locale/us/markets/stocks/tickers/AAPL"]);
  assert.equal((payload as { ticker?: { lastTrade?: { p?: number } } }).ticker?.lastTrade?.p, 196.58);
});

test("seeded fixture fallback fetcher synthesizes discovered ticker quotes when live Polygon rejects them", async () => {
  const fallback = createSeededFixtureFallbackFetcher({
    primary: async () => {
      throw new Error("polygon: HTTP 403");
    },
    fallback: createDevPolygonFetcher({ clock: () => new Date("2026-05-08T12:00:00.000Z") }),
  });

  const payload = await fallback("/v2/snapshot/locale/us/markets/stocks/tickers/SNDL");

  assert.equal(typeof (payload as { ticker?: { lastTrade?: { p?: unknown } } }).ticker?.lastTrade?.p, "number");
});

test("dev intraday bars pause overnight and stop at the clock, like Polygon's", async () => {
  const now = Date.parse("2026-05-08T15:00:00.000Z");
  const fetcher = createDevPolygonFetcher({ clock: () => new Date(now) });
  const start = Date.parse("2026-05-07T00:00:00.000Z");
  const end = Date.parse("2026-05-09T00:00:00.000Z");
  const payload = (await fetcher(`/v2/aggs/ticker/AAPL/range/15/minute/${start}/${end}`)) as {
    results: Array<{ t: number }>;
  };
  const ts = payload.results.map((bar) => bar.t);
  assert.ok(ts.length > 0);
  assert.ok(ts[ts.length - 1] < now);
  const gaps = ts.slice(1).map((t, i) => t - ts[i]);
  assert.ok(gaps.some((gap) => gap > 8 * 60 * 60_000), "no overnight gap");
});
