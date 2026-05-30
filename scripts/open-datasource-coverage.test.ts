import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

import { createFallbackTickerDiscoveryProvider } from "../services/resolver/src/dev-providers.ts";
import { createOpenReferenceTickerDiscoveryProvider } from "../services/resolver/src/open-reference-providers.ts";
import {
  GLEIF_REFERENCE_PROVIDER,
  NASDAQ_TRADER_REFERENCE_PROVIDER,
  OPENFIGI_REFERENCE_PROVIDER,
} from "../services/resolver/src/provider-sources.ts";
import { createStooqMarketDataAdapter } from "../services/market/src/adapters/stooq.ts";
import { createDailyBarsAwareFallbackMarketDataAdapter } from "../services/market/src/provider-composition.ts";
import {
  POLYGON_MARKET_SOURCE_ID,
  STOOQ_MARKET_PROVIDER,
  STOOQ_MARKET_SOURCE_ID,
} from "../services/market/src/provider-sources.ts";
import { isAvailable, unavailable } from "../services/market/src/availability.ts";
import type { MarketDataAdapter } from "../services/market/src/adapter.ts";
import type { ListingSubjectRef } from "../services/market/src/subject-ref.ts";

const REPO_ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const LISTING: ListingSubjectRef = {
  kind: "listing",
  id: "11111111-1111-4111-a111-111111111111",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

test("fixture smoke: paid misses can use open reference identity and Stooq EOD bars", async () => {
  const openReference = createOpenReferenceTickerDiscoveryProvider({
    nasdaqTrader: { enabled: true, baseUrl: "https://nasdaq.test" },
    openfigi: { enabled: true, baseUrl: "https://openfigi.test", apiKey: null },
    gleif: { enabled: true, baseUrl: "https://gleif.test/api/v1" },
    fetchImpl: async (input, init) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url === "https://nasdaq.test/dynamic/symdir/nasdaqlisted.txt") {
        return textResponse([
          "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
          "AMD|Advanced Micro Devices, Inc. - Common Stock|Q|N|N|100|N|N",
          "File Creation Time: 0529202618:03|||||||",
        ].join("\n"));
      }
      if (url === "https://nasdaq.test/dynamic/symdir/otherlisted.txt") {
        return textResponse([
          "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
          "File Creation Time: 0529202618:03||||||",
        ].join("\n"));
      }
      if (url === "https://openfigi.test/v3/mapping") {
        assert.equal(init?.method, "POST");
        return jsonResponse([
          {
            data: [
              {
                ticker: "AMD",
                micCode: "XNAS",
                marketSector: "Equity",
                securityType2: "Common Stock",
                compositeFIGI: "BBG000BBQCY0",
                isin: "US0079031078",
              },
            ],
          },
        ]);
      }
      if (url.startsWith("https://gleif.test/api/v1/lei-records?")) {
        return jsonResponse({
          data: [
            {
              attributes: {
                lei: "549300JAF7F4NE3JZ845",
                entity: {
                  legalName: { name: "Advanced Micro Devices, Inc." },
                  legalAddress: { country: "US" },
                },
                registration: { status: "ISSUED" },
              },
            },
          ],
        });
      }
      throw new Error(`unexpected resolver fixture request ${url}`);
    },
  });
  const discovery = createFallbackTickerDiscoveryProvider([
    { discoverTicker: async () => [] },
    openReference,
  ]);

  const [listing] = await discovery.discoverTicker("AMD");

  assert.equal(listing.ticker, "AMD");
  assert.equal(listing.mic, "XNAS");
  assert.equal(listing.trading_currency, "USD");
  assert.equal(listing.timezone, "America/New_York");
  assert.equal(listing.figi_composite, "BBG000BBQCY0");
  assert.equal(listing.isin, "US0079031078");
  assert.equal(listing.lei, "549300JAF7F4NE3JZ845");
  assert.deepEqual(
    listing.source_provenance?.map((source) => source.provider),
    [NASDAQ_TRADER_REFERENCE_PROVIDER, OPENFIGI_REFERENCE_PROVIDER, GLEIF_REFERENCE_PROVIDER],
  );

  const marketCalls: string[] = [];
  const primary: MarketDataAdapter = {
    providerName: "polygon_market",
    sourceId: POLYGON_MARKET_SOURCE_ID,
    async getQuote(request) {
      marketCalls.push("polygon:quote");
      return unavailable({
        reason: "missing_coverage",
        listing: request.listing,
        source_id: POLYGON_MARKET_SOURCE_ID,
        as_of: "2026-05-30T00:00:00.000Z",
        retryable: false,
      });
    },
    async getBars(request) {
      marketCalls.push(`polygon:bars:${request.interval}`);
      return unavailable({
        reason: "missing_coverage",
        listing: request.listing,
        source_id: POLYGON_MARKET_SOURCE_ID,
        as_of: "2026-05-30T00:00:00.000Z",
        retryable: false,
      });
    },
  };
  const stooq = createStooqMarketDataAdapter({
    baseUrl: "https://stooq.test/q/d/l/",
    sourceId: STOOQ_MARKET_SOURCE_ID,
    clock: () => new Date("2026-05-30T00:00:00.000Z"),
    resolveListing: async () => ({
      ticker: listing.ticker,
      mic: listing.mic,
      currency: listing.trading_currency,
      timezone: listing.timezone,
    }),
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      assert.match(url, /^https:\/\/stooq\.test\/q\/d\/l\/\?s=amd\.us&i=d&d1=20260528&d2=20260529$/);
      return textResponse([
        "Date,Open,High,Low,Close,Volume",
        "2026-05-28,100,111,99,110,1200",
        "2026-05-29,110,116,108,115,1300",
      ].join("\n"));
    },
  });
  const market = createDailyBarsAwareFallbackMarketDataAdapter({
    providerName: "dev_market",
    realtimeAdapters: [primary],
    dailyBarsFallbackAdapters: [stooq],
  });

  const bars = await market.getBars({
    listing: LISTING,
    interval: "1d",
    range: {
      start: "2026-05-28T04:00:00.000Z",
      end: "2026-05-30T04:00:00.000Z",
    },
    adjustment_basis: "split_and_div_adjusted",
  });
  const quote = await market.getQuote({ listing: LISTING });

  assert.equal(isAvailable(bars), true);
  if (!isAvailable(bars)) throw new Error("bars should be available");
  assert.deepEqual(marketCalls, ["polygon:bars:1d", "polygon:quote"]);
  assert.equal(bars.data.source_id, STOOQ_MARKET_SOURCE_ID);
  assert.equal(bars.data.delay_class, "eod");
  assert.equal(bars.data.adjustment_basis, "split_and_div_adjusted");
  assert.equal(bars.data.bars.length, 2);
  assert.equal(quote.outcome, "unavailable", "Stooq must not be used for realtime quote coverage");
});

test("docs trace the open datasource verification path and disclosures", async () => {
  const rootReadme = await readFile(join(REPO_ROOT, "README.md"), "utf8");
  const resolverReadme = await readFile(join(REPO_ROOT, "services/resolver/README.md"), "utf8");
  const marketReadme = await readFile(join(REPO_ROOT, "services/market/README.md"), "utf8");

  assert.match(rootReadme, /Open datasource coverage verification/i);
  assert.match(rootReadme, /node --experimental-strip-types --test scripts\/open-datasource-coverage\.test\.ts/);
  assert.match(rootReadme, /free reference enrichment/i);
  assert.match(rootReadme, /Stooq EOD bars are not realtime\s+quotes/i);
  assert.match(resolverReadme, /Verification/i);
  assert.match(resolverReadme, /Nasdaq Trader.*OpenFIGI.*GLEIF/is);
  assert.match(resolverReadme, /fill missing identity fields only/i);
  assert.match(marketReadme, /Verification/i);
  assert.match(marketReadme, /Stooq.*1d.*EOD/is);
  assert.match(marketReadme, /not.*realtime quote/i);
  assert.match(marketReadme, new RegExp(STOOQ_MARKET_PROVIDER));
});
