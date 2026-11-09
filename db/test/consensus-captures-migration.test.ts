import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { dbRoot, dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, expectRejected, startServer } from "./financial-migration-helpers.ts";

const FINVIZ = "00000000-0000-4000-a000-000000000015";
const ISSUER = "0f000000-0000-4000-8000-0000000000a1";
const LISTING = "0f000000-0000-4000-8000-0000000000e1";

function capture(fieldKey: string, unit: string, value: string, period: { name: string | null; basis: string | null } | null = null): string {
  return `insert into consensus_captures (issuer_id, listing_id, source_id, captured_on, retrieved_at, field_key, raw_label, raw_value, value, unit, fiscal_period, fiscal_period_basis)
          values ('${ISSUER}', '${LISTING}', '${FINVIZ}', '2026-11-09', '2026-11-09T06:00:00Z', '${fieldKey}', 'Label', '${value}', ${value === "-" ? "null" : value},
                  '${unit}', ${period?.name ? `'${period.name}'` : "null"}, ${period?.basis ? `'${period.basis}'` : "null"})
          on conflict do nothing`;
}

test("0080 consensus captures", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "consensus-captures-0080");
  const db = await createDatabase(t, server, "consensus_captures_0080");
  await applyCanonicalSchema(db);
  await db.query(await readFile(join(dbRoot, "seed", "sources.sql"), "utf8"));
  await db.query(`
    insert into issuers (issuer_id, legal_name) values ('${ISSUER}', 'Apple Inc');
    insert into instruments (instrument_id, issuer_id, asset_type)
      values ('0f000000-0000-4000-8000-0000000000b1', '${ISSUER}', 'common_stock');
    insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
      values ('${LISTING}', '0f000000-0000-4000-8000-0000000000b1', 'XNAS', 'AAPL', 'USD', 'America/New_York');
  `);

  await t.test("the seed registers the Finviz consensus source", async () => {
    assert.deepEqual(
      (await db.query(`select provider, kind::text, trust_tier::text, license_class from sources where source_id = '${FINVIZ}'`)).rows,
      [{ provider: "finviz_dev_consensus", kind: "reference_data", trust_tier: "tertiary", license_class: "free_dev" }],
    );
  });

  await t.test("one row per issuer, source, day and field; a same-day rerun inserts nothing and never rewrites", async () => {
    const period = { name: "FY2027", basis: "the fiscal year after FY2026" };
    assert.equal((await db.query(capture("eps_growth_this_y", "percent", "5.11", period))).rowCount, 1);
    assert.equal((await db.query(capture("eps_growth_this_y", "percent", "6.00", period))).rowCount, 0);
    assert.equal((await db.query(capture("target_price", "usd", "-"))).rowCount, 1);
    assert.deepEqual(
      (await db.query(`select field_key, raw_value, value::text, fiscal_period from consensus_captures order by field_key`)).rows,
      [
        { field_key: "eps_growth_this_y", raw_value: "5.11", value: "5.11", fiscal_period: "FY2027" },
        { field_key: "target_price", raw_value: "-", value: null, fiscal_period: null },
      ],
    );
    await expectRejected(db, `update consensus_captures set value = 1`, /consensus_captures rows are append-only/);
  });

  await t.test("field, unit and the period pair are closed", async () => {
    await expectRejected(db, capture("eps_ttm", "usd_per_share", "8.97"), /consensus_captures_field_key_check/);
    await expectRejected(db, capture("eps_next_q", "dollars", "2.90"), /consensus_captures_unit_check/);
    await expectRejected(db, capture("eps_next_q", "usd_per_share", "2.90", { name: null, basis: "the quarter after FY2026 Q4" }), /consensus_captures_fiscal_period_pair/);
  });

  await t.test("down drops the table and its source; up rebuilds what the canonical schema defines", async () => {
    await db.query(`delete from consensus_captures`);
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0080", "down");
    assert.deepEqual(
      (await db.query(`select to_regclass('consensus_captures')::text as captures, (select count(*)::int from sources where source_id = '${FINVIZ}') as sources`)).rows[0],
      { captures: null, sources: 0 },
    );
    await applyMigration(db, "0080", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
    assert.equal((await db.query(`select count(*)::int as n from sources where source_id = '${FINVIZ}'`)).rows[0].n, 1);
  });
});
