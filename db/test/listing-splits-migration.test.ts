import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, createDatabase, expectRejected, startServer } from "./financial-migration-helpers.ts";

const SOURCE = "0f000000-0000-4000-8000-0000000000c9";
const LISTING = "0f000000-0000-4000-8000-0000000000e1";

function insertSplit(date: string, splitFrom: string, splitTo: string): string {
  return `insert into listing_splits (listing_id, execution_date, split_from, split_to, source_id, provider_ref)
          values ('${LISTING}', '${date}', ${splitFrom}, ${splitTo}, '${SOURCE}', 'E1')`;
}

test("0064 listing splits", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "listing-splits-0064");
  const db = await createDatabase(t, server, "listing_splits_0064");
  await applyCanonicalSchema(db);
  await db.query(`
    insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
      values ('${SOURCE}', 'polygon_market', 'market_data', 'primary', 'licensed', now());
    insert into issuers (issuer_id, legal_name) values ('0f000000-0000-4000-8000-0000000000a1', 'Split Corp');
    insert into instruments (instrument_id, issuer_id, asset_type)
      values ('0f000000-0000-4000-8000-0000000000b1', '0f000000-0000-4000-8000-0000000000a1', 'common_stock');
    insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
      values ('${LISTING}', '0f000000-0000-4000-8000-0000000000b1', 'XNAS', 'SPLT', 'USD', 'America/New_York');
  `);

  await t.test("a split needs positive ratios and one row per listing and date", async () => {
    assert.equal((await db.query(insertSplit("2024-06-10", "1", "10"))).rowCount, 1);
    await expectRejected(db, insertSplit("2024-06-10", "1", "4"), /listing_splits_pkey/);
    await expectRejected(db, insertSplit("2021-07-20", "0", "4"), /listing_splits_split_from_check/);
    await expectRejected(db, insertSplit("2021-07-20", "1", "-4"), /listing_splits_split_to_check/);
  });

  await t.test("coverage is one row per listing", async () => {
    const coverage = `insert into listing_split_coverage (listing_id, checked_at, source_id) values ('${LISTING}', now(), '${SOURCE}')`;
    assert.equal((await db.query(coverage)).rowCount, 1);
    await expectRejected(db, coverage, /listing_split_coverage_pkey/);
  });

  await t.test("down drops both tables and up restores them", async () => {
    const tables = async () => (await db.query(
      `select to_regclass('listing_splits')::text as splits, to_regclass('listing_split_coverage')::text as coverage`,
    )).rows[0];
    await applyMigration(db, "0064", "down");
    assert.deepEqual(await tables(), { splits: null, coverage: null });
    await applyMigration(db, "0064", "up");
    assert.deepEqual(await tables(), { splits: "listing_splits", coverage: "listing_split_coverage" });
  });
});
