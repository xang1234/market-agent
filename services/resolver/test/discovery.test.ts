import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import {
  createPolygonTickerDiscoveryProvider,
  upsertDiscoveredListing,
  type DiscoveredListing,
} from "../src/discovery.ts";
import { fakePgQuery } from "../../shared/test/fake-query.ts";

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

test("upsertDiscoveredListing writes optional open reference identifiers through the insert contract", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db = {
    query: fakePgQuery(async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (text.includes("select issuer_id from issuers")) return { rows: [] };
      if (text.includes("insert into issuers")) {
        return { rows: [{ issuer_id: "11111111-1111-4111-a111-111111111111" }] };
      }
      if (text.includes("select instrument_id") && text.includes("from instruments")) {
        return { rows: [] };
      }
      if (text.includes("insert into instruments")) {
        return { rows: [{ instrument_id: "22222222-2222-4222-a222-222222222222" }] };
      }
      if (text.includes("select listing_id")) return { rows: [] };
      if (text.includes("insert into listings")) {
        return { rows: [{ listing_id: "33333333-3333-4333-a333-333333333333" }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }),
  };

  const subject = await upsertDiscoveredListing(db, {
    ticker: "AMD",
    legal_name: "Advanced Micro Devices, Inc.",
    market: "stocks",
    active: true,
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
    asset_type: "common_stock",
    cik: "0000002488",
    lei: "549300JAF7F4NE3JZ845",
    domicile: "us",
    isin: "us0079031078",
    figi_composite: "BBG000BBQCY0",
  });

  const issuerInsert = queries.find((query) => query.text.includes("insert into issuers"));
  const instrumentInsert = queries.find((query) => query.text.includes("insert into instruments"));
  assert.deepEqual(subject, { kind: "listing", id: "33333333-3333-4333-a333-333333333333" });
  assert.deepEqual(issuerInsert?.values, [
    "Advanced Micro Devices, Inc.",
    "2488",
    "549300JAF7F4NE3JZ845",
    "US",
  ]);
  assert.deepEqual(instrumentInsert?.values, [
    "11111111-1111-4111-a111-111111111111",
    "common_stock",
    null,
    "US0079031078",
    "BBG000BBQCY0",
    null,
  ]);
});

test("upsertDiscoveredListing writes a normalized cusip through the insert contract", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db = {
    query: fakePgQuery(async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (text.includes("select issuer_id from issuers")) return { rows: [] };
      if (text.includes("insert into issuers")) return { rows: [{ issuer_id: "11111111-1111-4111-a111-111111111111" }] };
      if (text.includes("select instrument_id") && text.includes("from instruments")) return { rows: [] };
      if (text.includes("insert into instruments")) return { rows: [{ instrument_id: "22222222-2222-4222-a222-222222222222" }] };
      if (text.includes("select listing_id")) return { rows: [] };
      if (text.includes("insert into listings")) return { rows: [{ listing_id: "33333333-3333-4333-a333-333333333333" }] };
      throw new Error(`Unexpected query: ${text}`);
    }),
  };

  await upsertDiscoveredListing(db, {
    ticker: "AAPL",
    legal_name: "Apple Inc.",
    market: "stocks",
    active: true,
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
    asset_type: "common_stock",
    cusip: "037833100",
  });

  const instrumentInsert = queries.find((query) => query.text.includes("insert into instruments"));
  assert.equal(instrumentInsert?.values?.[5], "037833100", "cusip is the 6th instrument insert value");
});

test("upsertDiscoveredListing enriches one exact legal-name issuer instead of inserting a duplicate", async () => {
  const queries: string[] = [];
  const db = {
    query: fakePgQuery(async (text: string, values?: unknown[]) => {
      queries.push(text);
      if (text.includes("select issuer_id from issuers where cik")) return { rows: [] };
      if (text.includes("select issuer_id from issuers where upper(lei)")) return { rows: [] };
      if (text.includes("from issuers where legal_name = $1")) {
        assert.deepEqual(values, ["Advanced Micro Devices, Inc."]);
        return { rows: [{ issuer_id: "11111111-1111-4111-a111-111111111111" }] };
      }
      if (text.includes("update issuers")) return { rows: [] };
      if (text.includes("insert into issuers")) {
        throw new Error("must not insert a duplicate issuer");
      }
      if (text.includes("select instrument_id") && text.includes("from instruments")) {
        return { rows: [] };
      }
      if (text.includes("insert into instruments")) {
        return { rows: [{ instrument_id: "22222222-2222-4222-a222-222222222222" }] };
      }
      if (text.includes("select listing_id")) return { rows: [] };
      if (text.includes("insert into listings")) {
        return { rows: [{ listing_id: "33333333-3333-4333-a333-333333333333" }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }),
  };

  await upsertDiscoveredListing(db, {
    ticker: "AMD",
    legal_name: "Advanced Micro Devices, Inc.",
    market: "stocks",
    active: true,
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
    asset_type: "common_stock",
    lei: "549300JAF7F4NE3JZ845",
    isin: "US0079031078",
  });

  assert.equal(queries.some((text) => text.includes("insert into issuers")), false);
  assert.equal(queries.some((text) => text.includes("update issuers")), true);
});

test("upsertDiscoveredListing resolves existing instrument identity before creating an issuer", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db = {
    query: fakePgQuery(async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (text.includes("select instrument_id, issuer_id from instruments where isin")) {
        assert.deepEqual(values, ["US0079031078"]);
        return {
          rows: [{
            instrument_id: "22222222-2222-4222-a222-222222222222",
            issuer_id: "11111111-1111-4111-a111-111111111111",
          }],
        };
      }
      if (text.includes("insert into issuers")) {
        throw new Error("must not create an orphan issuer when instrument identity already exists");
      }
      if (text.includes("update issuers")) return { rows: [] };
      if (text.includes("update instruments")) return { rows: [] };
      if (text.includes("select listing_id")) return { rows: [] };
      if (text.includes("insert into listings")) {
        assert.deepEqual(values, [
          "22222222-2222-4222-a222-222222222222",
          "XNAS",
          "AMD",
          "USD",
          "America/New_York",
        ]);
        return { rows: [{ listing_id: "33333333-3333-4333-a333-333333333333" }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }),
  };

  const subject = await upsertDiscoveredListing(db, {
    ticker: "AMD",
    legal_name: "Advanced Micro Devices, Inc.",
    market: "stocks",
    active: true,
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
    asset_type: "common_stock",
    lei: "549300JAF7F4NE3JZ845",
    domicile: "US",
    isin: "us0079031078",
    figi_composite: "BBG000BBQCY0",
  });

  assert.deepEqual(subject, { kind: "listing", id: "33333333-3333-4333-a333-333333333333" });
  assert.equal(queries.some((query) => query.text.includes("insert into issuers")), false);
});

test("upsertDiscoveredListing is idempotent and dedupes issuer/instrument/listing rows", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-nff-discovery");
  const client = await connectedClient(t, databaseUrl);
  const discovered: DiscoveredListing = {
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

test("upsertDiscoveredListing persists open reference identifiers on new rows", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-fhdw-open-reference-insert");
  const client = await connectedClient(t, databaseUrl);

  const subject = await upsertDiscoveredListing(client, {
    ticker: "AMD",
    legal_name: "Advanced Micro Devices, Inc.",
    market: "stocks",
    active: true,
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
    asset_type: "common_stock",
    cik: "0000002488",
    lei: "549300JAF7F4NE3JZ845",
    domicile: "US",
    isin: "US0079031078",
    figi_composite: "BBG000BBQCY0",
  });

  const stored = await client.query<{
    cik: string | null;
    lei: string | null;
    domicile: string | null;
    isin: string | null;
    figi_composite: string | null;
  }>(
    `select iss.cik, iss.lei, iss.domicile, i.isin, i.figi_composite
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = i.issuer_id
      where l.listing_id = $1`,
    [subject.id],
  );

  assert.deepEqual(stored.rows[0], {
    cik: "2488",
    lei: "549300JAF7F4NE3JZ845",
    domicile: "US",
    isin: "US0079031078",
    figi_composite: "BBG000BBQCY0",
  });
});

test("upsertDiscoveredListing fills missing identifiers without overwriting existing identity values", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-fhdw-open-reference-preserve");
  const client = await connectedClient(t, databaseUrl);
  const issuer = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name, cik, lei, domicile)
     values ('Advanced Micro Devices, Inc.', '2488', 'EXISTINGAMDLEI000001', 'US')
     returning issuer_id`,
  );
  const instrument = await client.query<{ instrument_id: string }>(
    `insert into instruments (issuer_id, asset_type, isin, figi_composite)
     values ($1, 'common_stock', 'US0000000001', 'BBGEXISTING1')
     returning instrument_id`,
    [issuer.rows[0].issuer_id],
  );
  const listing = await client.query<{ listing_id: string }>(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     values ($1, 'XNAS', 'AMD', 'USD', 'America/New_York')
     returning listing_id`,
    [instrument.rows[0].instrument_id],
  );

  const subject = await upsertDiscoveredListing(client, {
    ticker: "AMD",
    legal_name: "Advanced Micro Devices, Inc.",
    market: "stocks",
    active: true,
    mic: "XNAS",
    trading_currency: "USD",
    timezone: "America/New_York",
    asset_type: "common_stock",
    cik: "0000002488",
    lei: "549300JAF7F4NE3JZ845",
    domicile: "CA",
    isin: "US0079031078",
    figi_composite: "BBG000BBQCY0",
  });

  const stored = await client.query<{
    listing_id: string;
    lei: string | null;
    domicile: string | null;
    isin: string | null;
    figi_composite: string | null;
  }>(
    `select l.listing_id, iss.lei, iss.domicile, i.isin, i.figi_composite
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = i.issuer_id
      where l.ticker = 'AMD' and l.mic = 'XNAS'`,
  );

  assert.deepEqual(subject, { kind: "listing", id: listing.rows[0].listing_id });
  assert.deepEqual(stored.rows, [
    {
      listing_id: listing.rows[0].listing_id,
      lei: "EXISTINGAMDLEI000001",
      domicile: "US",
      isin: "US0000000001",
      figi_composite: "BBGEXISTING1",
    },
  ]);
});

async function seedListing(
  client: Awaited<ReturnType<typeof connectedClient>>,
  issuer: { legal_name: string; cik: string | null },
  ticker: string,
  { mic = "XNAS", figi_composite = null }: { mic?: string; figi_composite?: string | null } = {},
): Promise<{ issuer_id: string; listing_id: string }> {
  const iss = await client.query<{ issuer_id: string }>(
    "insert into issuers (legal_name, cik) values ($1, $2) returning issuer_id",
    [issuer.legal_name, issuer.cik],
  );
  const inst = await client.query<{ instrument_id: string }>(
    "insert into instruments (issuer_id, asset_type, figi_composite) values ($1, 'common_stock', $2) returning instrument_id",
    [iss.rows[0].issuer_id, figi_composite],
  );
  const lst = await client.query<{ listing_id: string }>(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     values ($1, $2, $3, 'USD', 'America/New_York') returning listing_id`,
    [inst.rows[0].instrument_id, mic, ticker],
  );
  return { issuer_id: iss.rows[0].issuer_id, listing_id: lst.rows[0].listing_id };
}

async function listingOwner(
  client: Awaited<ReturnType<typeof connectedClient>>,
  ticker: string,
): Promise<{ legal_name: string; cik: string | null }[]> {
  const rows = await client.query<{ legal_name: string; cik: string | null }>(
    `select iss.legal_name, iss.cik
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = i.issuer_id
      where l.ticker = $1 and l.mic = 'XNAS'`,
    [ticker],
  );
  return rows.rows;
}

const appleBundleEntry: DiscoveredListing = {
  ticker: "AAPL",
  legal_name: "Apple Inc",
  market: "stocks",
  active: true,
  mic: "XNAS",
  trading_currency: "USD",
  timezone: "America/New_York",
  asset_type: "common_stock",
};

test("a discovered entry without strong identity keeps an existing listing on its CIK issuer", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fix-403-keep-listing");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedListing(client, { legal_name: "Apple Inc.", cik: "320193" }, "AAPL");

  const subject = await upsertDiscoveredListing(client, appleBundleEntry);

  assert.deepEqual(subject, { kind: "listing", id: seeded.listing_id });
  assert.deepEqual(await listingOwner(client, "AAPL"), [{ legal_name: "Apple Inc.", cik: "320193" }]);
  const issuers = await client.query<{ count: string }>("select count(*)::text as count from issuers");
  assert.equal(issuers.rows[0].count, "1");
});

test("a discovered CIK fills a CIK-less issuer that already holds the listing", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fix-403-fill-cik");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedListing(client, { legal_name: "NVIDIA Corp", cik: null }, "NVDA");

  const subject = await upsertDiscoveredListing(client, {
    ...appleBundleEntry,
    ticker: "NVDA",
    legal_name: "NVIDIA Corporation",
    cik: "0001045810",
  });

  assert.deepEqual(subject, { kind: "listing", id: seeded.listing_id });
  assert.deepEqual(await listingOwner(client, "NVDA"), [{ legal_name: "NVIDIA Corp", cik: "1045810" }]);
  const issuers = await client.query<{ count: string }>("select count(*)::text as count from issuers");
  assert.equal(issuers.rows[0].count, "1");
});

test("a discovered CIK held by another issuer moves the listing to that issuer", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fix-403-heal-listing");
  const client = await connectedClient(t, databaseUrl);
  await client.query("insert into issuers (legal_name, cik) values ('Apple Inc.', '320193')");
  const seeded = await seedListing(client, { legal_name: "Apple Inc", cik: null }, "AAPL");

  const subject = await upsertDiscoveredListing(client, { ...appleBundleEntry, legal_name: "Apple Inc.", cik: "320193" });

  assert.deepEqual(subject, { kind: "listing", id: seeded.listing_id });
  assert.deepEqual(await listingOwner(client, "AAPL"), [{ legal_name: "Apple Inc.", cik: "320193" }]);
});

async function activeListings(
  client: Awaited<ReturnType<typeof connectedClient>>,
  ticker: string,
): Promise<{ listing_id: string; mic: string; legal_name: string; cik: string | null }[]> {
  const rows = await client.query<{ listing_id: string; mic: string; legal_name: string; cik: string | null }>(
    `select l.listing_id, l.mic, iss.legal_name, iss.cik
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = i.issuer_id
      where l.ticker = $1 and l.active_to is null
      order by l.mic`,
    [ticker],
  );
  return rows.rows;
}

test("a discovered CIK on another MIC fills the CIK-less issuer that holds the ticker, and a rerun keeps one listing", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fix-403-mic-mismatch");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedListing(client, { legal_name: "SPDR S&P 500 ETF Trust", cik: null }, "SPY", { mic: "XNYS" });

  const polygonEntry: DiscoveredListing = {
    ...appleBundleEntry,
    ticker: "SPY",
    legal_name: "SPDR S&P 500 ETF",
    mic: "ARCX",
    cik: "0000884394",
  };
  const first = await upsertDiscoveredListing(client, polygonEntry);
  const second = await upsertDiscoveredListing(client, polygonEntry);

  assert.deepEqual(await activeListings(client, "SPY"), [
    { listing_id: seeded.listing_id, mic: "XNYS", legal_name: "SPDR S&P 500 ETF Trust", cik: "884394" },
  ]);
  assert.deepEqual(first, { kind: "listing", id: seeded.listing_id });
  assert.deepEqual(second, { kind: "listing", id: seeded.listing_id });
});

test("a discovered US CIK leaves a non-US listing of the same ticker and currency alone", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fix-641-non-us-listing");
  const client = await connectedClient(t, databaseUrl);
  const london = await seedListing(client, { legal_name: "Anglo American plc", cik: null }, "AAL", { mic: "XLON" });

  const subject = await upsertDiscoveredListing(client, {
    ...appleBundleEntry,
    ticker: "AAL",
    legal_name: "American Airlines Group Inc",
    cik: "0000006201",
  });

  assert.notDeepEqual(subject, { kind: "listing", id: london.listing_id });
  assert.deepEqual((await activeListings(client, "AAL")).map(({ mic, legal_name, cik }) => ({ mic, legal_name, cik })), [
    { mic: "XLON", legal_name: "Anglo American plc", cik: null },
    { mic: "XNAS", legal_name: "American Airlines Group Inc", cik: "6201" },
  ]);
});

test("a name-only entry on another MIC keeps the ticker's listing on its CIK issuer",{ timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fix-403-mic-mismatch-name-only");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedListing(client, { legal_name: "SPDR S&P 500 ETF", cik: "884394" }, "SPY", { mic: "ARCX" });

  const subject = await upsertDiscoveredListing(client, {
    ...appleBundleEntry,
    ticker: "SPY",
    legal_name: "SPDR S&P 500 ETF Trust",
    mic: "XNYS",
  });

  assert.deepEqual(subject, { kind: "listing", id: seeded.listing_id });
  assert.deepEqual(await activeListings(client, "SPY"), [
    { listing_id: seeded.listing_id, mic: "ARCX", legal_name: "SPDR S&P 500 ETF", cik: "884394" },
  ]);
  const issuers = await client.query<{ count: string }>("select count(*)::text as count from issuers");
  assert.equal(issuers.rows[0].count, "1");
});

test("an entry on another MIC keeps the listing's own timezone", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fix-403-mic-mismatch-timezone");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedListing(client, { legal_name: "Shopify Inc.", cik: null }, "SHOP", { mic: "XNYS" });

  const subject = await upsertDiscoveredListing(client, {
    ...appleBundleEntry,
    ticker: "SHOP",
    legal_name: "Shopify Inc.",
    mic: "XTSE",
    timezone: "America/Toronto",
    cik: "0001594805",
  });

  assert.deepEqual(subject, { kind: "listing", id: seeded.listing_id });
  const listing = await client.query<{ mic: string; trading_currency: string; timezone: string }>(
    "select mic, trading_currency, timezone from listings where listing_id = $1",
    [seeded.listing_id],
  );
  assert.deepEqual(listing.rows, [{ mic: "XNYS", trading_currency: "USD", timezone: "America/New_York" }]);
});

test("a discovered CIK that differs from the listing issuer's CIK moves the listing", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fix-403-conflicting-cik");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedListing(client, { legal_name: "Old Holdings Inc.", cik: "1111111" }, "ZZZ");

  const subject = await upsertDiscoveredListing(client, {
    ...appleBundleEntry,
    ticker: "ZZZ",
    legal_name: "New Holdings Inc.",
    cik: "2222222",
  });

  assert.deepEqual(subject, { kind: "listing", id: seeded.listing_id });
  assert.deepEqual(await listingOwner(client, "ZZZ"), [{ legal_name: "New Holdings Inc.", cik: "2222222" }]);
});

test("a discovered FIGI that differs from the listing instrument's FIGI moves the listing", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver discovery coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fix-403-conflicting-figi");
  const client = await connectedClient(t, databaseUrl);
  const seeded = await seedListing(client, { legal_name: "Old Holdings Inc.", cik: null }, "ZZZ", {
    figi_composite: "BBG000000001",
  });

  const subject = await upsertDiscoveredListing(client, {
    ...appleBundleEntry,
    ticker: "ZZZ",
    legal_name: "New Holdings Inc.",
    figi_composite: "BBG000000002",
  });

  assert.deepEqual(subject, { kind: "listing", id: seeded.listing_id });
  assert.deepEqual(await listingOwner(client, "ZZZ"), [{ legal_name: "New Holdings Inc.", cik: null }]);
  const figi = await client.query<{ figi_composite: string }>(
    `select i.figi_composite from listings l join instruments i on i.instrument_id = l.instrument_id
      where l.listing_id = $1`,
    [seeded.listing_id],
  );
  assert.deepEqual(figi.rows, [{ figi_composite: "BBG000000002" }]);
});
