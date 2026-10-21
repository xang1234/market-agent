import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, expectRejected, IDS, seedLegacyEvidence, startServer } from "./financial-migration-helpers.ts";

const SERVICE_USER = "00000000-0000-4000-8000-0000000005ee";
const HASH = "a".repeat(64);
const PLAN = "0f000000-0000-4000-8000-0000000000f1";
const SUBJECTS = JSON.stringify([{ row: 0, issuer_id: IDS.issuer, listing_id: null, timezone: "America/New_York" }]);

const serviceUser = async (db: Client) => (await db.query(`select email, display_name from users where user_id = $1`, [SERVICE_USER])).rows;
const runsUnder = async (db: Client, chunk: string) =>
  (await db.query(`select count(*)::int as n from financial_runs where parent_kind = 'screener_valuation_run' and parent_id = $1`, [chunk])).rows[0].n;

/** A certification run's parent row, and a run with one unit under it, owned by the service user. */
async function insertCertificationRun(db: Client): Promise<string> {
  const chunk = (await db.query(`insert into screener_valuation_runs (as_of, subjects) values ('2024-06-10T14:00:00Z', $1::jsonb) returning screener_valuation_run_id::text as id`, [SUBJECTS])).rows[0].id;
  await db.query(
    `insert into financial_plans (plan_id, user_id, origin_kind, origin_ref, catalog_version, plan, semantic_hash, binding_hash)
     values ($1, $2, 'api_request', $3, 'catalog.v1', $4::jsonb, $5, $5)`,
    [PLAN, SERVICE_USER, `screener:${chunk}`, JSON.stringify({ plan_id: PLAN }), HASH],
  );
  const runId = (await db.query(
    `insert into financial_runs (user_id, parent_kind, parent_id, parent_version, request_key, request_hash, plan_id, feature_mode, knowledge_cutoff, policies, allowed_source_classes)
     values ($1, 'screener_valuation_run', $2::uuid, 'screener-valuation.v1', $2::text, $3, $4, 'enforce', '2024-06-10T14:00:00Z', '{}', '{sec_filing,market_data}') returning run_id::text`,
    [SERVICE_USER, chunk, HASH, PLAN],
  )).rows[0].run_id;
  await db.query(
    `insert into financial_run_units (run_id, unit_id, unit_kind, output_ids, closure_node_ids, closure_hash)
     values ($1, 'mc_r0', 'screener_valuation', '["o_mc_r0"]', '["mc_r0"]', $2)`,
    [runId, HASH],
  );
  return chunk;
}

test("0071 screener valuations", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "screener-valuations-0071");
  const db = await createDatabase(t, server, "screener_valuations_0071");
  await applyCanonicalSchema(db);
  await seedLegacyEvidence(db);

  await t.test("down then up rebuilds exactly what the canonical schema defines, the service user included", async () => {
    const canonical = await catalogSnapshot(db);
    const owner = [{ email: "screener-certification@system.invalid", display_name: "Screener certification" }];
    assert.deepEqual(await serviceUser(db), owner);
    await applyMigration(db, "0071", "down");
    assert.deepEqual(await serviceUser(db), []);
    await applyMigration(db, "0071", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
    assert.deepEqual(await serviceUser(db), owner);
  });

  await t.test("the ledger takes a screener run and unit, and down refuses to drop them", async () => {
    const chunk = await insertCertificationRun(db);
    assert.equal(await runsUnder(db, chunk), 1);
    await assert.rejects(() => applyMigration(db, "0071", "down"), /refusing to drop certified screener valuations/u);
  });

  await t.test("deleting a run's parent row erases the run", async () => {
    const [chunk] = (await db.query(`select screener_valuation_run_id::text as id from screener_valuation_runs`)).rows.map((row) => row.id as string);
    await db.query(`delete from screener_valuation_runs where screener_valuation_run_id = $1`, [chunk]);
    assert.equal(await runsUnder(db, chunk!), 0);
    assert.equal((await db.query(`select count(*)::int as n from financial_plans where plan_id = $1`, [PLAN])).rows[0].n, 0, "the plan goes with its last run");
    await applyMigration(db, "0071", "down");
    await applyMigration(db, "0071", "up");
  });

  await t.test("a valuation row holds a value or the reason it has none, a market cap's currency, and no negative market cap", async () => {
    const insert = (valuation: string, value: string | null, currency: string | null, reason: string | null) => [
      `insert into screener_certified_valuations (issuer_id, valuation, knowledge_cutoff, session_date, value, currency, reason_code, snapshot_id, financial_run_id, financial_unit_id)
       values ($1, $2, '2024-06-10T14:00:00Z', '2024-06-07', $3, $4, $5, gen_random_uuid(), gen_random_uuid(), 'mc_r0')`,
      [IDS.issuer, valuation, value, currency, reason],
    ] as const;
    for (const [args, constraint] of [
      [insert("pe_ratio", "100.5", null, "stale_input"), "value"],
      [insert("pe_ratio", null, null, null), "value"],
      [insert("pe_ratio", "100.5", "USD", null), "currency"],
      [insert("market_cap", "2956800000000", null, null), "currency"],
      [insert("market_cap", null, "USD", "stale_input"), "currency"],
      [insert("market_cap", "-1", "USD", null), "market_cap"],
    ] as const) {
      await expectRejected(db, args[0], new RegExp(`screener_certified_valuations_${constraint}`, "u"), [...args[1]]);
    }
  });
});
