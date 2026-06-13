import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { normalizeUniverseToIssuers } from "../src/subject-normalization.ts";

const ISSUER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ISSUER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DANGLING_LISTING = "99999999-9999-4999-8999-999999999999";
const THEME_ID = "77777777-7777-4777-8777-777777777777";

test("normalizeUniverseToIssuers maps listings/instruments to issuers, dedupes, passes others through", async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker not available");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "grid-subject-norm");
  const db = await connectedClient(t, databaseUrl);

  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'Acme Corp'), ($2, 'Globex Inc')`, [
    ISSUER_A,
    ISSUER_B,
  ]);
  const { rows: instARows } = await db.query<{ instrument_id: string }>(
    `insert into instruments (issuer_id, asset_type) values ($1, 'common_stock') returning instrument_id::text as instrument_id`,
    [ISSUER_A],
  );
  const instrumentA = instARows[0].instrument_id;
  const { rows: instBRows } = await db.query<{ instrument_id: string }>(
    `insert into instruments (issuer_id, asset_type) values ($1, 'common_stock') returning instrument_id::text as instrument_id`,
    [ISSUER_B],
  );
  const instrumentB = instBRows[0].instrument_id;
  const { rows: listingRows } = await db.query<{ listing_id: string }>(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     values ($1, 'XNAS', 'ACME', 'USD', 'America/New_York'), ($1, 'XLON', 'ACME', 'GBP', 'Europe/London')
     returning listing_id::text as listing_id`,
    [instrumentA],
  );
  const [listingA1, listingA2] = listingRows.map((r) => r.listing_id);

  const normalized = await normalizeUniverseToIssuers(db, [
    { kind: "listing", id: listingA1 },
    { kind: "listing", id: listingA2 }, // second listing of the same issuer — dedupes away
    { kind: "instrument", id: instrumentB },
    { kind: "issuer", id: ISSUER_A }, // already mapped from listingA1 — dedupes away
    { kind: "theme", id: THEME_ID }, // unmappable kind passes through
    { kind: "listing", id: DANGLING_LISTING }, // no matching listing row — passes through
  ]);

  assert.deepEqual(normalized, [
    { kind: "issuer", id: ISSUER_A },
    { kind: "issuer", id: ISSUER_B },
    { kind: "theme", id: THEME_ID },
    { kind: "listing", id: DANGLING_LISTING },
  ]);
});

test("normalizeUniverseToIssuers with no refs issues no queries and returns empty", async () => {
  let queries = 0;
  const db = {
    query: async () => {
      queries += 1;
      return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
    },
  };
  const normalized = await normalizeUniverseToIssuers(db, []);
  assert.deepEqual(normalized, []);
  assert.equal(queries, 0);
});
