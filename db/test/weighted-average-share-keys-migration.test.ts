import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, createDatabase, startServer } from "./financial-migration-helpers.ts";

test("0065 keys the weighted-average share counts as weighted averages, keeping their metric ids", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "share-keys-0065");
  const db = await createDatabase(t, server, "share_keys_0065");
  await applyCanonicalSchema(db);
  await db.query(`
    insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class) values
      ('00000000-0000-4000-8000-000000000001', 'shares_outstanding_basic', 'Shares Outstanding (Basic)', 'count', 'avg', 'neutral', 'gaap'),
      ('00000000-0000-4000-8000-000000000002', 'shares_outstanding_diluted', 'Shares Outstanding (Diluted)', 'count', 'avg', 'neutral', 'gaap'),
      ('00000000-0000-4000-8000-000000000003', 'eps_basic', 'EPS (Basic)', 'currency', 'derived', 'higher_is_better', 'gaap')`);
  const registry = async () => (await db.query(`select metric_id::text, metric_key, display_name from metrics order by metric_id`)).rows;
  const original = [
    { metric_id: "00000000-0000-4000-8000-000000000001", metric_key: "shares_outstanding_basic", display_name: "Shares Outstanding (Basic)" },
    { metric_id: "00000000-0000-4000-8000-000000000002", metric_key: "shares_outstanding_diluted", display_name: "Shares Outstanding (Diluted)" },
    { metric_id: "00000000-0000-4000-8000-000000000003", metric_key: "eps_basic", display_name: "EPS (Basic)" },
  ];
  const renamed = [
    { metric_id: "00000000-0000-4000-8000-000000000001", metric_key: "weighted_average_basic_shares", display_name: "Weighted-average basic shares" },
    { metric_id: "00000000-0000-4000-8000-000000000002", metric_key: "weighted_average_diluted_shares", display_name: "Weighted-average diluted shares" },
    { metric_id: "00000000-0000-4000-8000-000000000003", metric_key: "eps_basic", display_name: "EPS (Basic)" },
  ];

  await applyMigration(db, "0065", "up");
  assert.deepEqual(await registry(), renamed);
  await applyMigration(db, "0065", "up");
  assert.deepEqual(await registry(), renamed, "rerunning changes nothing");
  await applyMigration(db, "0065", "down");
  assert.deepEqual(await registry(), original);
});
