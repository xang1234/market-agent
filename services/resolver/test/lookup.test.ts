import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "pg";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import {
  resolveByCik,
  resolveByInput,
  resolveByIsin,
  resolveByLei,
  resolveByTicker,
} from "../src/lookup.ts";
import { isAmbiguous, isResolved, isNotFound } from "../src/envelope.ts";

type AppleChain = {
  issuer_id: string;
  instrument_id: string;
  listing_id: string;
};

async function seedAppleChain(client: Client): Promise<AppleChain> {
  const issuer = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name, cik, lei, domicile, sector, industry)
     values ($1, $2, $3, $4, $5, $6)
     returning issuer_id`,
    ["Apple Inc.", "320193", "HWUPKR0MPOU8FGXBT394", "US", "Technology", "Consumer Electronics"],
  );
  const issuer_id = issuer.rows[0].issuer_id;

  const instrument = await client.query<{ instrument_id: string }>(
    `insert into instruments (issuer_id, asset_type, share_class, isin)
     values ($1, 'common_stock', null, $2)
     returning instrument_id`,
    [issuer_id, "US0378331005"],
  );
  const instrument_id = instrument.rows[0].instrument_id;

  const listing = await client.query<{ listing_id: string }>(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     values ($1, 'XNAS', 'AAPL', 'USD', 'America/New_York')
     returning listing_id`,
    [instrument_id],
  );
  const listing_id = listing.rows[0].listing_id;

  return { issuer_id, instrument_id, listing_id };
}

async function traceIssuerFromListing(client: Client, listing_id: string) {
  const result = await client.query<{ issuer_id: string }>(
    `select i.issuer_id from listings l
       join instruments i on i.instrument_id = l.instrument_id
      where l.listing_id = $1`,
    [listing_id],
  );
  return result.rows[0]?.issuer_id;
}

async function traceIssuerFromInstrument(client: Client, instrument_id: string) {
  const result = await client.query<{ issuer_id: string }>(
    "select issuer_id from instruments where instrument_id = $1",
    [instrument_id],
  );
  return result.rows[0]?.issuer_id;
}

test("cross-family equivalence: ticker/CIK/ISIN/LEI all trace back to the same Apple issuer", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver lookup coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-3");
  const client = await connectedClient(t, databaseUrl);
  const apple = await seedAppleChain(client);

  const byTicker = await resolveByTicker(client, "AAPL");
  const byCikPadded = await resolveByCik(client, "0000320193");
  const byCikStripped = await resolveByCik(client, "320193");
  const byIsin = await resolveByIsin(client, "US0378331005");
  const byLei = await resolveByLei(client, "HWUPKR0MPOU8FGXBT394");

  assert.ok(isResolved(byTicker));
  assert.ok(isResolved(byCikPadded));
  assert.ok(isResolved(byCikStripped));
  assert.ok(isResolved(byIsin));
  assert.ok(isResolved(byLei));

  assert.equal(byTicker.subject_ref.kind, "listing");
  assert.equal(byTicker.subject_ref.id, apple.listing_id);

  assert.equal(byIsin.subject_ref.kind, "instrument");
  assert.equal(byIsin.subject_ref.id, apple.instrument_id);

  assert.equal(byCikPadded.subject_ref.kind, "issuer");
  assert.equal(byCikPadded.subject_ref.id, apple.issuer_id);
  assert.equal(byCikStripped.subject_ref.id, byCikPadded.subject_ref.id);

  assert.equal(byLei.subject_ref.kind, "issuer");
  assert.equal(byLei.subject_ref.id, apple.issuer_id);

  assert.equal(await traceIssuerFromListing(client, byTicker.subject_ref.id), apple.issuer_id);
  assert.equal(await traceIssuerFromInstrument(client, byIsin.subject_ref.id), apple.issuer_id);
});

test("case-insensitive ISIN and LEI lookups", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver lookup coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-3");
  const client = await connectedClient(t, databaseUrl);
  const apple = await seedAppleChain(client);

  const isinLower = await resolveByIsin(client, "us0378331005");
  const leiLower = await resolveByLei(client, "hwupkr0mpou8fgxbt394");

  assert.ok(isResolved(isinLower));
  assert.ok(isResolved(leiLower));
  assert.equal(isinLower.subject_ref.id, apple.instrument_id);
  assert.equal(leiLower.subject_ref.id, apple.issuer_id);
});

test("unknown identifiers produce not_found with normalized input", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver lookup coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-3");
  const client = await connectedClient(t, databaseUrl);

  const ticker = await resolveByTicker(client, "NOTREAL");
  const cik = await resolveByCik(client, "9999999999");
  const isin = await resolveByIsin(client, "ZZ1234567890");
  const lei = await resolveByLei(client, "ZZZZZZZZZZZZZZZZZZZZ");

  assert.ok(isNotFound(ticker));
  assert.ok(isNotFound(cik));
  assert.ok(isNotFound(isin));
  assert.ok(isNotFound(lei));

  assert.equal(ticker.normalized_input, "NOTREAL");
  assert.equal(ticker.reason, "unknown_ticker");
  assert.equal(cik.reason, "unknown_cik");
  assert.equal(isin.reason, "unknown_isin");
  assert.equal(lei.reason, "unknown_lei");
});

test("ticker matching multiple MICs returns ambiguous with multiple_listings axis", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver lookup coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-3");
  const client = await connectedClient(t, databaseUrl);
  const apple = await seedAppleChain(client);

  await client.query(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     values ($1, 'XFRA', 'AAPL', 'EUR', 'Europe/Berlin')`,
    [apple.instrument_id],
  );

  const envelope = await resolveByTicker(client, "AAPL");
  assert.ok(isAmbiguous(envelope));
  assert.equal(envelope.candidates.length, 2);
  assert.equal(envelope.ambiguity_axis, "multiple_listings");

  const micFiltered = await resolveByTicker(client, "AAPL", { mic: "XNAS" });
  assert.ok(isResolved(micFiltered));
  assert.equal(micFiltered.subject_ref.id, apple.listing_id);
});

test("same ticker across different issuers surfaces multiple_issuers axis", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver lookup coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-3");
  const client = await connectedClient(t, databaseUrl);
  await seedAppleChain(client);

  const otherIssuer = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name, cik) values ('Apple Historical Other Corp.', '9999999')
     returning issuer_id`,
  );
  const otherInstrument = await client.query<{ instrument_id: string }>(
    `insert into instruments (issuer_id, asset_type) values ($1, 'common_stock')
     returning instrument_id`,
    [otherIssuer.rows[0].issuer_id],
  );
  await client.query(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     values ($1, 'XLON', 'AAPL', 'GBP', 'Europe/London')`,
    [otherInstrument.rows[0].instrument_id],
  );

  const envelope = await resolveByTicker(client, "AAPL");
  assert.ok(isAmbiguous(envelope));
  assert.equal(envelope.ambiguity_axis, "multiple_issuers");
});

test("resolveByInput dispatches to the right family based on discriminator", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for resolver lookup coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-3-3");
  const client = await connectedClient(t, databaseUrl);
  const apple = await seedAppleChain(client);

  const viaTicker = await resolveByInput(client, { kind: "ticker", value: "AAPL" });
  const viaCik = await resolveByInput(client, { kind: "cik", value: "0000320193" });
  const viaIsin = await resolveByInput(client, { kind: "isin", value: "US0378331005" });
  const viaLei = await resolveByInput(client, { kind: "lei", value: "HWUPKR0MPOU8FGXBT394" });

  assert.ok(isResolved(viaTicker));
  assert.ok(isResolved(viaCik));
  assert.ok(isResolved(viaIsin));
  assert.ok(isResolved(viaLei));

  assert.equal(viaCik.subject_ref.id, apple.issuer_id);
  assert.equal(viaIsin.subject_ref.id, apple.instrument_id);
  assert.equal(viaTicker.subject_ref.id, apple.listing_id);
  assert.equal(viaLei.subject_ref.id, apple.issuer_id);
});
