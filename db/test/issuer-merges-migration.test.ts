import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, startServer } from "./financial-migration-helpers.ts";

test("0085 issuer merges", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "issuer-merges-0085");
  const db = await createDatabase(t, server, "issuer_merges_0085");
  await applyCanonicalSchema(db);

  const canonical = await catalogSnapshot(db);
  await applyMigration(db, "0085", "down");
  assert.deepEqual(
    (await db.query(`select to_regclass('issuer_merges') as merges, to_regprocedure('current_issuer_id(uuid)') as current`)).rows,
    [{ merges: null, current: null }],
  );
  await applyMigration(db, "0085", "up");
  assert.deepEqual(await catalogSnapshot(db), canonical);
});
