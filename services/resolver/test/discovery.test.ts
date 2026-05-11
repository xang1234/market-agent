import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import {
  createPolygonTickerDiscoveryProvider,
  upsertDiscoveredListing,
} from "../src/discovery.ts";

test("polygon discovery maps active stock rows and skips malformed rows", async () => {
  const requestedPaths: string[] = [];
  const provider = createPolygonTickerDiscoveryProvider({
    apiKey: "polygon-test-key",
    fetcher: async (path) => {
      requestedPaths.push(path);
      return {
        status: "OK",
        results: [
          {
            ticker: "AMD",
            name: "Advanced Micro Devices, Inc.",
            market: "stocks",
            active: true,
            primary_exchange: "XNAS",
            currency_symbol: "USD",
            type: "CS",
            cik: "0000002488",
            composite_figi: "BBG000BBQCY0",
          },
          {
            ticker: "AMD",
            name: "Missing Exchange Corp.",
            market: "stocks",
            active: true,
            currency_symbol: "USD",
            type: "CS",
          },
          {
            ticker: "AMD",
            name: "Crypto Pair",
            market: "crypto",
            active: true,
            primary_exchange: "XNAS",
            currency_symbol: "USD",
            type: "CS",
          },
        ],
      };
    },
  });

  const discovered = await provider.discoverTicker("amd");

  assert.equal(discovered.length, 1);
  assert.deepEqual(discovered[0], {
    ticker: "AMD",
    legal_name: "Advanced Micro Devices, Inc.",
    market: "stocks",
    active: true,
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
    asset_type: "common_stock",
    cik: "2488",
    figi_composite: "BBG000BBQCY0",
  });
  assert.equal(
    requestedPaths[0],
    "/v3/reference/tickers?ticker=AMD&market=stocks&active=true&limit=1000&apiKey=polygon-test-key",
  );
});

test("upsertDiscoveredListing is idempotent and dedupes issuer/instrument/listing rows", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-nff-discovery");
  const client = await connectedClient(t, databaseUrl);
  const discovered = {
    ticker: "AMD",
    legal_name: "Advanced Micro Devices, Inc.",
    market: "stocks" as const,
    active: true,
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
    asset_type: "common_stock" as const,
    cik: "0000002488",
    figi_composite: "BBG000BBQCY0",
  };

  const first = await upsertDiscoveredListing(client, discovered);
  const second = await upsertDiscoveredListing(client, discovered);

  assert.deepEqual(second, first);
  assert.equal(first.kind, "listing");

  const counts = await client.query<{
    issuers: string;
    instruments: string;
    listings: string;
  }>(
    `select
       (select count(*)::text from issuers where cik = '2488') as issuers,
       (select count(*)::text from instruments where figi_composite = 'BBG000BBQCY0') as instruments,
       (select count(*)::text from listings where ticker = 'AMD' and mic = 'XNAS') as listings`,
  );
  assert.deepEqual(counts.rows[0], { issuers: "1", instruments: "1", listings: "1" });
});
