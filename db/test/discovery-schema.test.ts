import assert from "node:assert/strict";
import test from "node:test";

import {
  bootstrapDatabase,
  connectedPool,
  createContainerName,
  dbRoot,
  dockerAvailable,
  registerLifoCleanup,
  run,
  startPostgres,
  stopPostgres,
  waitForPostgres,
} from "./docker-pg.ts";

const tables = [
  "discovery_campaigns", "discovery_briefs", "discovery_runs", "discovery_candidates", "discovery_attempts", "discovery_events",
];
const options = { skip: !dockerAvailable(), timeout: 120_000 };

test("fresh consolidated schema installs all discovery tables and invariants", options, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "discovery-schema-fresh");
  const db = await connectedPool(t, databaseUrl);
  await assertDiscoverySchema(db);
  await assert.rejects(
    db.query("insert into discovery_runs (campaign_id,user_id,brief_id,request_key,status,stage,policy_version,limits,usage,checkpoint,coverage) values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'invalid','queued','v1','{}','{}','{}','{}')"),
  );
});

test("migration path installs discovery schema and rollback removes only discovery objects", options, async (t) => {
  const containerName = createContainerName("discovery-schema-migrated");
  const password = "postgres";
  registerLifoCleanup(t, () => stopPostgres(containerName));
  const port = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await waitForPostgres(containerName, databaseUrl);
  const migrated = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], { cwd: dbRoot, env: { DATABASE_URL: databaseUrl } });
  assert.equal(migrated.status, 0, migrated.stderr || migrated.stdout);
  const db = await connectedPool(t, databaseUrl);
  await assertDiscoverySchema(db);
  const rolledBackLatest = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], { cwd: dbRoot, env: { DATABASE_URL: databaseUrl } });
  assert.equal(rolledBackLatest.status, 0, rolledBackLatest.stderr || rolledBackLatest.stdout);
  const rolledBackDiscovery = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], { cwd: dbRoot, env: { DATABASE_URL: databaseUrl } });
  assert.equal(rolledBackDiscovery.status, 0, rolledBackDiscovery.stderr || rolledBackDiscovery.stdout);
  const after = await db.query<{ discovery: string | null; metrics: string | null }>("select to_regclass('public.discovery_campaigns')::text as discovery,to_regclass('public.metrics')::text as metrics");
  assert.equal(after.rows[0]?.discovery, null);
  assert.equal(after.rows[0]?.metrics, "metrics");
});

async function assertDiscoverySchema(db: { query: <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> }) {
  const installed = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' and table_name = any($1::text[]) order by table_name", [tables]);
  assert.deepEqual(installed.rows.map((row) => row.table_name), [...tables].sort());
  const indexes = await db.query<{ indexname: string }>("select indexname from pg_indexes where schemaname='public' and tablename in ('discovery_runs','discovery_candidates')");
  const names = new Set(indexes.rows.map((row) => row.indexname));
  for (const expected of ["discovery_request_identity", "discovery_one_active_run_per_user", "discovery_candidate_issuer", "discovery_candidate_lead", "discovery_shortlist_rank"]) assert.equal(names.has(expected), true);
  const attemptFlag = await db.query<{ data_type: string; is_nullable: string }>(
    "select data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='discovery_attempts' and column_name='model_initial'",
  );
  assert.deepEqual(attemptFlag.rows, [{ data_type: "boolean", is_nullable: "NO" }]);
}
