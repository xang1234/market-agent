import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { enrichCusip } from "../src/cusip-enrichment.ts";

const OPENFIGI = { enabled: true, baseUrl: "https://openfigi.test", apiKey: null };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const APPLE_MAPPING = [
  {
    data: [
      {
        ticker: "AAPL",
        name: "APPLE INC",
        micCode: "XNAS",
        marketSector: "Equity",
        securityType: "Common Stock",
        compositeFIGI: "BBG000B9XRY4",
        isin: "US0378331005",
      },
    ],
  },
];

test("enrichCusip creates the issuer/instrument from OpenFIGI and records the cusip", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "cusip-enrich");
  const client = await connectedClient(t, databaseUrl);
  const db = client as never;

  const result = await enrichCusip(
    { db, openfigi: OPENFIGI, fetchImpl: async () => jsonResponse(APPLE_MAPPING) },
    "037833100",
  );

  assert.equal(result.status, "enriched");
  assert.equal(result.ticker, "AAPL");
  assert.ok(result.issuer_id, "resolves the newly-created issuer");

  const row = await client.query<{ cusip: string; isin: string; legal_name: string }>(
    `select i.cusip, i.isin, iss.legal_name
       from instruments i join issuers iss on iss.issuer_id = i.issuer_id
      where i.cusip = '037833100'`,
  );
  assert.equal(row.rows.length, 1, "an instrument now carries the cusip");
  assert.equal(row.rows[0]!.isin, "US0378331005");
  assert.equal(row.rows[0]!.legal_name, "APPLE INC");
});

test("enrichCusip is a no-op (no OpenFIGI call) when the CUSIP already resolves", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "cusip-enrich-already");
  const client = await connectedClient(t, databaseUrl);
  const db = client as never;
  const seeded = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name) values ('Apple Inc.') returning issuer_id::text as issuer_id`,
  );
  await client.query(`insert into instruments (issuer_id, asset_type, cusip) values ($1, 'common_stock', '037833100')`, [
    seeded.rows[0]!.issuer_id,
  ]);

  let called = false;
  const result = await enrichCusip(
    {
      db,
      openfigi: OPENFIGI,
      fetchImpl: async () => {
        called = true;
        return jsonResponse(APPLE_MAPPING);
      },
    },
    "037833100",
  );
  assert.equal(result.status, "already");
  assert.equal(result.issuer_id, seeded.rows[0]!.issuer_id);
  assert.equal(called, false, "no OpenFIGI call when already resolvable");
});

test("enrichCusip reports unmapped and writes nothing when OpenFIGI has no match", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "cusip-enrich-unmapped");
  const client = await connectedClient(t, databaseUrl);
  const db = client as never;

  const result = await enrichCusip(
    { db, openfigi: OPENFIGI, fetchImpl: async () => jsonResponse([{ error: "No identifier found." }]) },
    "999999999",
  );
  assert.equal(result.status, "unmapped");
  assert.equal((await client.query(`select count(*)::int as n from instruments`)).rows[0]!.n, 0, "nothing written");
});
