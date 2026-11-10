import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { dbRoot, dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, expectRejected, startServer } from "./financial-migration-helpers.ts";

const YAHOO = "00000000-0000-4000-a000-00000000000b";
const LISTING = "0f000000-0000-4000-8000-0000000000e2";

function close(tradeDate: string, closeText: string, capturedOn = "2026-11-10", basis = "split_adjusted"): string {
  return `insert into daily_close_captures (listing_id, source_id, captured_on, retrieved_at, trade_date, close_text, currency, adjustment_basis)
          values ('${LISTING}', '${YAHOO}', '${capturedOn}', '${capturedOn}T06:00:00Z', '${tradeDate}', '${closeText}', 'USD', '${basis}')
          on conflict do nothing`;
}

test("0081 daily close captures", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "daily-close-captures-0081");
  const db = await createDatabase(t, server, "daily_close_captures_0081");
  await applyCanonicalSchema(db);
  await db.query(await readFile(join(dbRoot, "seed", "sources.sql"), "utf8"));
  await db.query(`
    insert into issuers (issuer_id, legal_name) values ('0f000000-0000-4000-8000-0000000000a2', 'Costco');
    insert into instruments (instrument_id, issuer_id, asset_type)
      values ('0f000000-0000-4000-8000-0000000000b2', '0f000000-0000-4000-8000-0000000000a2', 'common_stock');
    insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
      values ('${LISTING}', '0f000000-0000-4000-8000-0000000000b2', 'XNAS', 'COST', 'USD', 'America/New_York');
  `);

  await t.test("one close per listing, source, trade date and capture day, kept as its exact text and never rewritten", async () => {
    assert.equal((await db.query(close("2016-11-10", "151.1999969482422"))).rowCount, 1);
    assert.equal((await db.query(close("2016-11-10", "151.2"))).rowCount, 0);
    assert.equal((await db.query(close("2016-11-10", "50.4", "2026-11-11"))).rowCount, 1);
    assert.deepEqual(
      (await db.query(`select captured_on::text, trade_date::text, close_text from daily_close_captures order by captured_on`)).rows,
      [
        { captured_on: "2026-11-10", trade_date: "2016-11-10", close_text: "151.1999969482422" },
        { captured_on: "2026-11-11", trade_date: "2016-11-10", close_text: "50.4" },
      ],
    );
    await expectRejected(db, `update daily_close_captures set close_text = '1'`, /daily_close_captures rows are append-only/);
  });

  await t.test("a close is a positive decimal and the basis is split adjusted", async () => {
    for (const bad of ["0", "-151.2", "abc", "1.", ""]) {
      await expectRejected(db, close("2016-11-11", bad), /daily_close_captures_close_text_check/);
    }
    await expectRejected(db, close("2016-11-11", "151.2", "2026-11-10", "split_and_div_adjusted"), /daily_close_captures_adjustment_basis_check/);
  });

  await t.test("down drops the table; up rebuilds what the canonical schema defines", async () => {
    await db.query(`delete from daily_close_captures`);
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0081", "down");
    assert.equal((await db.query(`select to_regclass('daily_close_captures')::text as captures`)).rows[0].captures, null);
    await applyMigration(db, "0081", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
  });
});
