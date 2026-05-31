import test from "node:test";
import assert from "node:assert/strict";

import {
  createOpenReferenceTickerDiscoveryProvider,
} from "../src/open-reference-providers.ts";
import { createFallbackTickerDiscoveryProvider } from "../src/dev-providers.ts";
import {
  GLEIF_REFERENCE_PROVIDER,
  GLEIF_REFERENCE_SOURCE_ID,
  NASDAQ_TRADER_REFERENCE_PROVIDER,
  NASDAQ_TRADER_REFERENCE_SOURCE_ID,
  OPENFIGI_REFERENCE_PROVIDER,
  OPENFIGI_REFERENCE_SOURCE_ID,
} from "../src/provider-sources.ts";

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

const EMPTY_OTHER_LISTED = [
  "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
  "File Creation Time: 0529202618:03||||||",
].join("\n");

test("open reference provider validates Nasdaq-listed symbols and enriches them with FIGI and LEI metadata", async () => {
  const requests: Array<{ url: string; method: string; body?: unknown; apiKey?: string | null }> = [];
  const provider = createOpenReferenceTickerDiscoveryProvider({
    nasdaqTrader: { enabled: true, baseUrl: "https://nasdaq.test" },
    openfigi: { enabled: true, baseUrl: "https://openfigi.test", apiKey: "figi-key" },
    gleif: { enabled: true, baseUrl: "https://gleif.test/api/v1" },
    fetchImpl: async (input, init) => {
      const url = input instanceof URL ? input.toString() : String(input);
      const method = init?.method ?? "GET";
      requests.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        apiKey: init?.headers instanceof Headers
          ? init.headers.get("X-OPENFIGI-APIKEY")
          : (init?.headers as Record<string, string> | undefined)?.["X-OPENFIGI-APIKEY"],
      });

      if (url === "https://nasdaq.test/dynamic/symdir/nasdaqlisted.txt") {
        return textResponse([
          "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
          "AMD|Advanced Micro Devices, Inc. - Common Stock|Q|N|N|100|N|N",
          "AMDD|Advanced Micro Devices Test|Q|Y|N|100|N|N",
          "File Creation Time: 0529202618:03|||||||",
        ].join("\n"));
      }
      if (url === "https://nasdaq.test/dynamic/symdir/otherlisted.txt") {
        return textResponse(EMPTY_OTHER_LISTED);
      }
      if (url === "https://openfigi.test/v3/mapping") {
        return jsonResponse([
          {
            data: [
              {
                ticker: "AMD",
                name: "ADVANCED MICRO DEVICES INC",
                exchCode: "US",
                micCode: "XNAS",
                marketSector: "Equity",
                securityType2: "Common Stock",
                compositeFIGI: "BBG000BBQCY0",
                shareClassFIGI: "BBG001S5NN36",
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
              id: "549300JAF7F4NE3JZ845",
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

      throw new Error(`unexpected request ${method} ${url}`);
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
      isin: "US0079031078",
      figi_composite: "BBG000BBQCY0",
      lei: "549300JAF7F4NE3JZ845",
      domicile: "US",
      source_provenance: [
        {
          provider: NASDAQ_TRADER_REFERENCE_PROVIDER,
          source_id: NASDAQ_TRADER_REFERENCE_SOURCE_ID,
          fields: ["ticker", "legal_name", "mic", "trading_currency", "timezone", "asset_type"],
        },
        {
          provider: OPENFIGI_REFERENCE_PROVIDER,
          source_id: OPENFIGI_REFERENCE_SOURCE_ID,
          fields: ["figi_composite", "isin"],
        },
        {
          provider: GLEIF_REFERENCE_PROVIDER,
          source_id: GLEIF_REFERENCE_SOURCE_ID,
          fields: ["lei", "domicile"],
        },
      ],
    },
  ]);
  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["GET", "https://nasdaq.test/dynamic/symdir/nasdaqlisted.txt"],
    ["GET", "https://nasdaq.test/dynamic/symdir/otherlisted.txt"],
    ["POST", "https://openfigi.test/v3/mapping"],
    [
      "GET",
      "https://gleif.test/api/v1/lei-records?filter%5Bentity.legalName%5D=Advanced+Micro+Devices%2C+Inc.&filter%5Bregistration.status%5D=ISSUED&page%5Bsize%5D=5",
    ],
  ]);
  assert.deepEqual(requests[2].body, [{ idType: "TICKER", idValue: "AMD", micCode: "XNAS" }]);
  assert.equal(requests[2].apiKey, "figi-key");
});

test("open reference provider keeps base Nasdaq validation but refuses ambiguous FIGI or LEI enrichment", async () => {
  const provider = createOpenReferenceTickerDiscoveryProvider({
    nasdaqTrader: { enabled: true, baseUrl: "https://nasdaq.test" },
    openfigi: { enabled: true, baseUrl: "https://openfigi.test", apiKey: null },
    gleif: { enabled: true, baseUrl: "https://gleif.test/api/v1" },
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url === "https://nasdaq.test/dynamic/symdir/nasdaqlisted.txt") {
        return textResponse([
          "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
          "SHOP|Shopify Inc. - Class A Subordinate Voting Shares|Q|N|N|100|N|N",
          "File Creation Time: 0529202618:03|||||||",
        ].join("\n"));
      }
      if (url === "https://nasdaq.test/dynamic/symdir/otherlisted.txt") {
        return textResponse(EMPTY_OTHER_LISTED);
      }
      if (url === "https://openfigi.test/v3/mapping") {
        return jsonResponse([
          {
            data: [
              {
                ticker: "SHOP",
                micCode: "XNAS",
                marketSector: "Equity",
                securityType2: "Common Stock",
                compositeFIGI: "BBG008HBD923",
              },
              {
                ticker: "SHOP",
                micCode: "XNAS",
                marketSector: "Equity",
                securityType2: "Common Stock",
                compositeFIGI: "BBG00AMBIG01",
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
                lei: "549300KNWZK93DKWHZ16",
                entity: {
                  legalName: { name: "Shopify Inc." },
                  legalAddress: { country: "CA" },
                },
                registration: { status: "ISSUED" },
              },
            },
            {
              attributes: {
                lei: "529900AMBIGLEI0001",
                entity: {
                  legalName: { name: "Shopify Inc." },
                  legalAddress: { country: "CA" },
                },
                registration: { status: "ISSUED" },
              },
            },
          ],
        });
      }
      throw new Error(`unexpected request ${url}`);
    },
  });

  const [listing] = await provider.discoverTicker("SHOP");

  assert.equal(listing.ticker, "SHOP");
  assert.equal(listing.legal_name, "Shopify Inc.");
  assert.equal(listing.figi_composite, undefined);
  assert.equal(listing.lei, undefined);
  assert.deepEqual(listing.source_provenance, [
    {
      provider: NASDAQ_TRADER_REFERENCE_PROVIDER,
      source_id: NASDAQ_TRADER_REFERENCE_SOURCE_ID,
      fields: ["ticker", "legal_name", "mic", "trading_currency", "timezone", "asset_type"],
    },
  ]);
});

test("open reference provider degrades optional enrichment provider failures to Nasdaq-only coverage", async () => {
  const provider = createOpenReferenceTickerDiscoveryProvider({
    nasdaqTrader: { enabled: true, baseUrl: "https://nasdaq.test" },
    openfigi: { enabled: true, baseUrl: "https://openfigi.test", apiKey: null },
    gleif: { enabled: true, baseUrl: "https://gleif.test/api/v1" },
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url === "https://nasdaq.test/dynamic/symdir/nasdaqlisted.txt") {
        return textResponse([
          "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
          "IBM|International Business Machines Corporation Common Stock|Q|N|N|100|N|N",
          "File Creation Time: 0529202618:03|||||||",
        ].join("\n"));
      }
      if (url === "https://nasdaq.test/dynamic/symdir/otherlisted.txt") {
        return textResponse(EMPTY_OTHER_LISTED);
      }
      if (url === "https://openfigi.test/v3/mapping") return jsonResponse({ error: "limited" }, 429);
      if (url.startsWith("https://gleif.test/api/v1/lei-records?")) return jsonResponse({ error: "down" }, 503);
      throw new Error(`unexpected request ${url}`);
    },
  });

  const [listing] = await provider.discoverTicker("IBM");

  assert.equal(listing.ticker, "IBM");
  assert.equal(listing.legal_name, "International Business Machines Corporation");
  assert.equal(listing.figi_composite, undefined);
  assert.equal(listing.lei, undefined);
  assert.deepEqual(listing.source_provenance, [
    {
      provider: NASDAQ_TRADER_REFERENCE_PROVIDER,
      source_id: NASDAQ_TRADER_REFERENCE_SOURCE_ID,
      fields: ["ticker", "legal_name", "mic", "trading_currency", "timezone", "asset_type"],
    },
  ]);
});

test("open reference provider keeps available Nasdaq rows when one directory file is unavailable", async () => {
  const provider = createOpenReferenceTickerDiscoveryProvider({
    nasdaqTrader: { enabled: true, baseUrl: "https://nasdaq.test" },
    openfigi: { enabled: false, baseUrl: "https://openfigi.test", apiKey: null },
    gleif: { enabled: false, baseUrl: "https://gleif.test/api/v1" },
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url === "https://nasdaq.test/dynamic/symdir/nasdaqlisted.txt") {
        return textResponse([
          "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
          "MSFT|Microsoft Corporation Common Stock|Q|N|N|100|N|N",
          "File Creation Time: 0529202618:03|||||||",
        ].join("\n"));
      }
      if (url === "https://nasdaq.test/dynamic/symdir/otherlisted.txt") {
        return textResponse("temporary unavailable", 503);
      }
      throw new Error(`unexpected request ${url}`);
    },
  });

  const discovered = await provider.discoverTicker("MSFT");

  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].ticker, "MSFT");
  assert.equal(discovered[0].legal_name, "Microsoft Corporation");
});

test("open reference provider refuses GLEIF legal-name suffix mismatches", async () => {
  const provider = createOpenReferenceTickerDiscoveryProvider({
    nasdaqTrader: { enabled: true, baseUrl: "https://nasdaq.test" },
    openfigi: { enabled: false, baseUrl: "https://openfigi.test", apiKey: null },
    gleif: { enabled: true, baseUrl: "https://gleif.test/api/v1" },
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url === "https://nasdaq.test/dynamic/symdir/nasdaqlisted.txt") {
        return textResponse([
          "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
          "ACME|Acme Inc. Common Stock|Q|N|N|100|N|N",
          "File Creation Time: 0529202618:03|||||||",
        ].join("\n"));
      }
      if (url === "https://nasdaq.test/dynamic/symdir/otherlisted.txt") {
        return textResponse(EMPTY_OTHER_LISTED);
      }
      if (url.startsWith("https://gleif.test/api/v1/lei-records?")) {
        return jsonResponse({
          data: [
            {
              attributes: {
                lei: "549300ACMESUFFIX001",
                entity: {
                  legalName: { name: "Acme Ltd." },
                  legalAddress: { country: "US" },
                },
                registration: { status: "ISSUED" },
              },
            },
          ],
        });
      }
      throw new Error(`unexpected request ${url}`);
    },
  });

  const [listing] = await provider.discoverTicker("ACME");

  assert.equal(listing.legal_name, "Acme Inc.");
  assert.equal(listing.lei, undefined);
  assert.equal(listing.domicile, undefined);
});

test("open reference provider refuses GLEIF enrichment when the candidate page is truncated", async () => {
  const provider = createOpenReferenceTickerDiscoveryProvider({
    nasdaqTrader: { enabled: true, baseUrl: "https://nasdaq.test" },
    openfigi: { enabled: false, baseUrl: "https://openfigi.test", apiKey: null },
    gleif: { enabled: true, baseUrl: "https://gleif.test/api/v1" },
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url === "https://nasdaq.test/dynamic/symdir/nasdaqlisted.txt") {
        return textResponse([
          "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
          "ACME|Acme Inc. Common Stock|Q|N|N|100|N|N",
          "File Creation Time: 0529202618:03|||||||",
        ].join("\n"));
      }
      if (url === "https://nasdaq.test/dynamic/symdir/otherlisted.txt") {
        return textResponse(EMPTY_OTHER_LISTED);
      }
      if (url.startsWith("https://gleif.test/api/v1/lei-records?")) {
        return jsonResponse({
          data: [
            {
              attributes: {
                lei: "549300ACMEPAGE00001",
                entity: {
                  legalName: { name: "Acme Inc." },
                  legalAddress: { country: "US" },
                },
                registration: { status: "ISSUED" },
              },
            },
          ],
          links: {
            next: "https://gleif.test/api/v1/lei-records?page[number]=2",
          },
          meta: {
            pagination: {
              currentPage: 1,
              lastPage: 2,
              total: 6,
            },
          },
        });
      }
      throw new Error(`unexpected request ${url}`);
    },
  });

  const [listing] = await provider.discoverTicker("ACME");

  assert.equal(listing.legal_name, "Acme Inc.");
  assert.equal(listing.lei, undefined);
  assert.equal(listing.domicile, undefined);
});

test("fallback discovery can use open reference coverage after paid discovery has no candidates", async () => {
  let paidCalls = 0;
  const openReferenceProvider = createOpenReferenceTickerDiscoveryProvider({
    nasdaqTrader: { enabled: true, baseUrl: "https://nasdaq.test" },
    openfigi: { enabled: false, baseUrl: "https://openfigi.test", apiKey: null },
    gleif: { enabled: false, baseUrl: "https://gleif.test/api/v1" },
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url === "https://nasdaq.test/dynamic/symdir/nasdaqlisted.txt") {
        return textResponse([
          "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
          "AMD|Advanced Micro Devices, Inc. - Common Stock|Q|N|N|100|N|N",
          "File Creation Time: 0529202618:03|||||||",
        ].join("\n"));
      }
      if (url === "https://nasdaq.test/dynamic/symdir/otherlisted.txt") {
        return textResponse(EMPTY_OTHER_LISTED);
      }
      throw new Error(`unexpected request ${url}`);
    },
  });
  const fallback = createFallbackTickerDiscoveryProvider([
    {
      discoverTicker: async () => {
        paidCalls += 1;
        return [];
      },
    },
    openReferenceProvider,
  ]);

  const discovered = await fallback.discoverTicker("AMD");

  assert.equal(paidCalls, 1);
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].ticker, "AMD");
  assert.equal(discovered[0].mic, "XNAS");
});
