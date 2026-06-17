import test from "node:test";
import assert from "node:assert/strict";

import { resolveHoldingsByIssuer } from "../src/sec-13f-resolve.ts";
import type { Form13fFiling, Form13fHolding } from "../src/sec-13f-extractor.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

function holding(over: Partial<Form13fHolding>): Form13fHolding {
  return { nameOfIssuer: "X", cusip: "000000000", valueRaw: 0, shares: 0, sshPrnamtType: "SH", putCall: null, ...over };
}
function filing(holdings: Form13fHolding[]): Form13fFiling {
  return { periodOfReport: "2026-03-31", holdings };
}

async function seedIssuerWithCusip(client: { query: QueryExecutor["query"] }, name: string, cusip: string): Promise<string> {
  const r = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name) values ($1) returning issuer_id::text as issuer_id`,
    [name],
  );
  const id = r.rows[0]!.issuer_id;
  await client.query(`insert into instruments (issuer_id, asset_type, cusip) values ($1, 'common_stock', $2)`, [id, cusip]);
  return id;
}

test("resolveHoldingsByIssuer sums multi-class CUSIPs by issuer and returns the misses", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-resolve-multiclass");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

  // One issuer, two share classes (two CUSIPs); a third CUSIP is untracked.
  const alphabet = await seedIssuerWithCusip(client, "Alphabet Inc.", "02079K305"); // GOOGL
  await client.query(`insert into instruments (issuer_id, asset_type, cusip) values ($1, 'common_stock', '02079K107')`, [alphabet]); // GOOG

  const { resolved, unresolved } = await resolveHoldingsByIssuer(
    db,
    filing([
      holding({ nameOfIssuer: "ALPHABET INC CL A", cusip: "02079K305", valueRaw: 1000, shares: 100 }),
      holding({ nameOfIssuer: "ALPHABET INC CL C", cusip: "02079K107", valueRaw: 2000, shares: 200 }),
      holding({ nameOfIssuer: "UNTRACKED CO", cusip: "999999999", valueRaw: 50, shares: 5 }),
    ]),
    "2026-05-15",
  );

  assert.equal(resolved.length, 1, "one issuer-level row, not one-per-CUSIP");
  assert.equal(resolved[0]!.issuerId, alphabet);
  assert.equal(resolved[0]!.shares, 300, "100 + 200 summed across share classes");
  assert.equal(resolved[0]!.valueUsd, 3000, "1000 + 2000 summed");
  assert.deepEqual(
    unresolved.map((u) => u.cusip),
    ["999999999"],
    "the untracked CUSIP is reported as a miss (not silently dropped)",
  );
});

test("resolveHoldingsByIssuer normalizes pre-2023 values from thousands and excludes option rows", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "f13f-resolve-units");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const aapl = await seedIssuerWithCusip(client, "Apple Inc.", "037833100");

  const { resolved } = await resolveHoldingsByIssuer(
    db,
    filing([
      holding({ nameOfIssuer: "APPLE INC", cusip: "037833100", valueRaw: 50000, shares: 1000 }), // direct
      holding({ nameOfIssuer: "APPLE INC", cusip: "037833100", valueRaw: 9999, shares: 555, putCall: "Call" }), // option → excluded
    ]),
    "2022-11-14", // pre-2023 → value reported in thousands
  );

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]!.issuerId, aapl);
  assert.equal(resolved[0]!.shares, 1000, "the call option's 555 shares are not counted");
  assert.equal(resolved[0]!.valueUsd, 50_000_000, "50000 (thousands) → 50,000,000 USD");
});
