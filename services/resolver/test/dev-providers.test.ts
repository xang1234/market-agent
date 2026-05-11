import test from "node:test";
import assert from "node:assert/strict";
import {
  createDevProvidersTickerDiscoveryProvider,
  createFallbackTickerDiscoveryProvider,
} from "../src/dev-providers.ts";
import type { TickerDiscoveryProvider } from "../src/discovery.ts";

test("dev provider discovery maps available yfinance candidates into discovered listings", async () => {
  const requested: string[] = [];
  const provider = createDevProvidersTickerDiscoveryProvider({
    baseUrl: "http://dev-providers.test",
    fetchImpl: async (url) => {
      requested.push(String(url));
      return new Response(JSON.stringify({
        status: "available",
        data: {
          listings: [
            {
              ticker: "AMD",
              legal_name: "Advanced Micro Devices, Inc.",
              mic: "XNAS",
              trading_currency: "USD",
              timezone: "America/New_York",
              asset_type: "common_stock",
              cik: "0000002488",
            },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const discovered = await provider.discoverTicker("amd");

  assert.deepEqual(discovered, [
    {
      ticker: "AMD",
      legal_name: "Advanced Micro Devices, Inc.",
      market: "stocks",
      active: true,
      mic: "XNAS",
      trading_currency: "USD",
      timezone: "America/New_York",
      asset_type: "common_stock",
      cik: "2488",
    },
  ]);
  assert.equal(requested[0], "http://dev-providers.test/reference/ticker/AMD");
});

test("dev provider discovery degrades unavailable sidecar responses to no candidates", async () => {
  const provider = createDevProvidersTickerDiscoveryProvider({
    baseUrl: "http://dev-providers.test",
    fetchImpl: async () => new Response(JSON.stringify({
      status: "unavailable",
      reason: "missing_coverage",
      retryable: false,
      detail: "no clean listing",
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.deepEqual(await provider.discoverTicker("NOTREAL"), []);
});

test("fallback discovery tries yfinance only when primary discovery has no clean candidates", async () => {
  const calls: string[] = [];
  const primary: TickerDiscoveryProvider = {
    async discoverTicker(ticker) {
      calls.push(`primary:${ticker}`);
      return [];
    },
  };
  const fallback: TickerDiscoveryProvider = {
    async discoverTicker(ticker) {
      calls.push(`fallback:${ticker}`);
      return [
        {
          ticker: "AMD",
          legal_name: "Advanced Micro Devices, Inc.",
          market: "stocks",
          active: true,
          mic: "XNAS",
          trading_currency: "USD",
          timezone: "America/New_York",
          asset_type: "common_stock",
        },
      ];
    },
  };

  const provider = createFallbackTickerDiscoveryProvider([primary, fallback]);

  assert.equal((await provider.discoverTicker("AMD")).length, 1);
  assert.deepEqual(calls, ["primary:AMD", "fallback:AMD"]);
});

test("fallback discovery tries yfinance when primary discovery throws", async () => {
  const calls: string[] = [];
  const primary: TickerDiscoveryProvider = {
    async discoverTicker(ticker) {
      calls.push(`primary:${ticker}`);
      throw new Error("polygon reference HTTP 403");
    },
  };
  const fallback: TickerDiscoveryProvider = {
    async discoverTicker(ticker) {
      calls.push(`fallback:${ticker}`);
      return [
        {
          ticker: "AMD",
          legal_name: "Advanced Micro Devices, Inc.",
          market: "stocks",
          active: true,
          mic: "XNAS",
          trading_currency: "USD",
          timezone: "America/New_York",
          asset_type: "common_stock",
        },
      ];
    },
  };

  const provider = createFallbackTickerDiscoveryProvider([primary, fallback]);

  assert.equal((await provider.discoverTicker("AMD")).length, 1);
  assert.deepEqual(calls, ["primary:AMD", "fallback:AMD"]);
});

test("fallback discovery does not call lower-trust providers after primary discovery succeeds", async () => {
  let fallbackCalls = 0;
  const primary: TickerDiscoveryProvider = {
    async discoverTicker() {
      return [
        {
          ticker: "AMD",
          legal_name: "Advanced Micro Devices, Inc.",
          market: "stocks",
          active: true,
          mic: "XNAS",
          trading_currency: "USD",
          timezone: "America/New_York",
          asset_type: "common_stock",
        },
      ];
    },
  };
  const fallback: TickerDiscoveryProvider = {
    async discoverTicker() {
      fallbackCalls++;
      return [];
    },
  };

  const provider = createFallbackTickerDiscoveryProvider([primary, fallback]);

  assert.equal((await provider.discoverTicker("AMD")).length, 1);
  assert.equal(fallbackCalls, 0);
});
