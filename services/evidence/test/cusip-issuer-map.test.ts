import test from "node:test";
import assert from "node:assert/strict";
import { resolveIssuerByCusip } from "../src/cusip-issuer-map.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

test("resolveIssuerByCusip matches an explicit cusip and derives from a US ISIN", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "cusip-resolve");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

  // Issuer A: instrument carries the CUSIP explicitly.
  const a = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name) values ('Apple Inc.') returning issuer_id::text as issuer_id`,
  );
  const issuerA = a.rows[0]!.issuer_id;
  await client.query(`insert into instruments (issuer_id, asset_type, cusip) values ($1, 'common_stock', '037833100')`, [issuerA]);

  // Issuer B: only a US ISIN (US + 594918104 + check digit) — CUSIP derived from it.
  const b = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name) values ('Microsoft Corp') returning issuer_id::text as issuer_id`,
  );
  const issuerB = b.rows[0]!.issuer_id;
  await client.query(`insert into instruments (issuer_id, asset_type, isin) values ($1, 'common_stock', 'US5949181045')`, [issuerB]);

  assert.equal(await resolveIssuerByCusip(db, "037833100"), issuerA, "explicit cusip resolves");
  assert.equal(await resolveIssuerByCusip(db, "594918104"), issuerB, "cusip derived from US ISIN resolves");
  assert.equal(await resolveIssuerByCusip(db, "037833100".toLowerCase()), issuerA, "case-insensitive");
  assert.equal(await resolveIssuerByCusip(db, "000000000"), null, "unknown CUSIP → null");
  assert.equal(await resolveIssuerByCusip(db, "12345"), null, "non-9-char input → null");

  // Ambiguous: two distinct issuers carry the same explicit cusip → don't guess.
  const c = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name) values ('Dup A') returning issuer_id::text as issuer_id`,
  );
  await client.query(`insert into instruments (issuer_id, asset_type, cusip) values ($1, 'common_stock', '111111111')`, [c.rows[0]!.issuer_id]);
  const d = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name) values ('Dup B') returning issuer_id::text as issuer_id`,
  );
  await client.query(`insert into instruments (issuer_id, asset_type, cusip) values ($1, 'common_stock', '111111111')`, [d.rows[0]!.issuer_id]);
  assert.equal(await resolveIssuerByCusip(db, "111111111"), null, "ambiguous direct match → null, not an arbitrary issuer");
});
