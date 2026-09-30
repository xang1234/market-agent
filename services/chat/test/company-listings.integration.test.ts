import test from "node:test";
import assert from "node:assert/strict";

import { companyListings } from "../src/fact-blocks.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const ISSUER = "63000000-0000-4000-8000-000000000001";
const INSTRUMENT = "63000000-0000-4000-8000-000000000002";
const AS_OF = "2026-09-01T00:00:00.000Z";

test("a company's chart listing is the one active at the turn's cutoff", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for company listing coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-company-listings");
  const client = await connectedClient(t, databaseUrl);
  await client.query(`insert into issuers (issuer_id, legal_name) values ($1::uuid, 'Scheduled Co')`, [ISSUER]);
  await client.query(
    `insert into instruments (instrument_id, issuer_id, asset_type, share_class)
     values ($1::uuid, $2::uuid, 'common_stock', 'common')`,
    [INSTRUMENT, ISSUER],
  );
  // Alphabetical order would pick AAA first; only CCC is active at the cutoff.
  for (const [ticker, activeFrom, activeTo] of [
    ["AAA", "2026-10-01T00:00:00Z", null], // not listed yet
    ["BBB", "2020-01-01T00:00:00Z", "2026-08-01T00:00:00Z"], // delisted
    ["CCC", "2020-01-01T00:00:00Z", "2027-01-01T00:00:00Z"], // active, delisting scheduled
  ]) {
    await client.query(
      `insert into listings (instrument_id, mic, ticker, trading_currency, timezone, active_from, active_to)
       values ($1::uuid, 'XNAS', $2, 'USD', 'America/New_York', $3::timestamptz, $4::timestamptz)`,
      [INSTRUMENT, ticker, activeFrom, activeTo],
    );
  }

  const listings = await companyListings(client, [ISSUER], AS_OF);
  assert.equal(listings.get(ISSUER)?.label, "CCC");
});
