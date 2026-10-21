import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, expectRejected, IDS, seedLegacyEvidence, startServer } from "./financial-migration-helpers.ts";

const HASH = "a".repeat(64);
const PLAN = "0f000000-0000-4000-8000-0000000000e3";
const PARENT = "0f000000-0000-4000-8000-0000000000e4";

async function insertPlan(db: Client): Promise<void> {
  await db.query(
    `insert into financial_plans (plan_id, user_id, origin_kind, origin_ref, catalog_version, plan, semantic_hash, binding_hash)
     values ($1, $2, 'grid_run', 'grid:1', 'catalog.v1', $3::jsonb, $4, $4)`,
    [PLAN, IDS.owner, JSON.stringify({ plan_id: PLAN, schema_version: "financial_plan.v1" }), HASH],
  );
}

/** A run under request key `key`; `classes` null inserts it without a grant, as before 0070. */
async function insertRun(db: Client, key: string, classes: string | null): Promise<string> {
  const columns = classes === null ? "" : ", allowed_source_classes";
  const values = classes === null ? "" : ", $5::text[]";
  return (await db.query<{ run_id: string }>(
    `insert into financial_runs (user_id, parent_kind, parent_id, parent_version, request_key, request_hash, plan_id, feature_mode, knowledge_cutoff, policies${columns})
     values ($1, 'analyst_grid_run', $2, 'grid-run.v1', $3, $4, '${PLAN}', 'enforce', '2026-10-21T00:00:00Z', '{}'${values}) returning run_id::text`,
    [IDS.owner, PARENT, key, HASH, ...(classes === null ? [] : [classes])],
  )).rows[0]!.run_id;
}

test("0070 financial run source classes", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "run-source-classes-0070");
  const db = await createDatabase(t, server, "run_source_classes_0070");
  await applyCanonicalSchema(db);
  await seedLegacyEvidence(db);
  await insertPlan(db);

  await t.test("down then up rebuilds exactly what the canonical schema defines", async () => {
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0070", "down");
    assert.equal((await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'financial_runs' and column_name = 'allowed_source_classes'`)).rows[0].n, 0);
    await applyMigration(db, "0070", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
  });

  await t.test("a run reserved before 0070 was granted SEC filings only, as every surface was", async () => {
    await applyMigration(db, "0070", "down");
    const runId = await insertRun(db, "before-0070", null);
    await applyMigration(db, "0070", "up");
    assert.deepEqual((await db.query(`select allowed_source_classes from financial_runs where run_id = $1`, [runId])).rows, [{ allowed_source_classes: ["sec_filing"] }]);
  });

  await t.test("a run states its grant, from the class vocabulary, and never changes it", async () => {
    const runId = await insertRun(db, "granted", "{market_data,sec_filing}");
    assert.deepEqual((await db.query(`select allowed_source_classes from financial_runs where run_id = $1`, [runId])).rows, [{ allowed_source_classes: ["market_data", "sec_filing"] }]);
    await expectRejected(db, `update financial_runs set allowed_source_classes = '{sec_filing}' where run_id = $1`, /immutable/, [runId]);
    for (const [key, classes] of [["empty", "{}"], ["unknown", "{press_release}"], ["null_class", "{NULL}"]]) {
      await expectRejected(db, `insert into financial_runs (user_id, parent_kind, parent_id, parent_version, request_key, request_hash, plan_id, feature_mode, knowledge_cutoff, policies, allowed_source_classes)
                                values ($1, 'analyst_grid_run', $2, 'grid-run.v1', $3, $4, '${PLAN}', 'enforce', now(), '{}', $5::text[])`,
        /financial_runs_allowed_source_classes/, [IDS.owner, PARENT, key, HASH, classes]);
    }
    await expectRejected(db, `insert into financial_runs (user_id, parent_kind, parent_id, parent_version, request_key, request_hash, plan_id, feature_mode, knowledge_cutoff, policies)
                              values ($1, 'analyst_grid_run', $2, 'grid-run.v1', 'ungranted', $3, '${PLAN}', 'enforce', now(), '{}')`,
      /allowed_source_classes/, [IDS.owner, PARENT, HASH]);
  });

  await t.test("down refuses while a run recorded a grant beyond SEC filings", async () => {
    await assert.rejects(() => applyMigration(db, "0070", "down"), /reverting 0070 would drop it/);
    await db.query(`delete from financial_runs where allowed_source_classes <> '{sec_filing}'`);
    await applyMigration(db, "0070", "down");
    await applyMigration(db, "0070", "up");
  });
});
