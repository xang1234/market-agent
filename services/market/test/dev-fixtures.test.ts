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
