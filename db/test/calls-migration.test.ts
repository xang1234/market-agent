import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, expectRejected, startServer } from "./financial-migration-helpers.ts";

const row = (change: { fingerprint?: string; hash?: string; settings?: string } = {}) =>
  `insert into calls (snapshot_id, inputs_snapshot_id, inputs_run_id, inputs_unit_id, call_date, settings, inputs_fingerprint, content_hash)
   values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'unit', '2026-11-09', '${change.settings ?? "{}"}', '${change.fingerprint ?? "a".repeat(64)}', '${change.hash ?? "b".repeat(64)}')`;

test("0082 calls", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "calls-0082");
  const db = await createDatabase(t, server, "calls_0082");
  await applyCanonicalSchema(db);

  await t.test("the fingerprint and content hash are SHA-256 hex, and the settings an object", async () => {
    await expectRejected(db, row({ fingerprint: "x" }), /calls_inputs_fingerprint_check/);
    await expectRejected(db, row({ hash: "B".repeat(64) }), /calls_content_hash_check/);
    await expectRejected(db, row({ settings: "[]" }), /calls_settings_check/);
    await expectRejected(db, row(), /calls_snapshot_id_fkey|calls_inputs_snapshot_id_inputs_run_id_inputs_unit_id_fkey/);
  });

  await t.test("down drops the table and its erasure trigger; up rebuilds what the canonical schema defines", async () => {
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0082", "down");
    assert.equal((await db.query(`select to_regclass('calls')::text as calls`)).rows[0].calls, null);
    await applyMigration(db, "0082", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
  });
});
