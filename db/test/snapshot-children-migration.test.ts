import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, expectRejected, startServer } from "./financial-migration-helpers.ts";

async function snapshot(db: Client, parent: string | null = null): Promise<string> {
  const snapshotId = randomUUID();
  await db.query(
    `insert into snapshots (snapshot_id, subject_refs, as_of, basis, normalization, allowed_transforms, parent_snapshot)
     values ($1, '[]'::jsonb, now(), 'unadjusted', 'none', '{}'::jsonb, $2)`,
    [snapshotId, parent],
  );
  return snapshotId;
}

async function remaining(db: Client, snapshotIds: string[]): Promise<string[]> {
  return (await db.query<{ snapshot_id: string }>(
    `select snapshot_id::text from snapshots where snapshot_id = any($1::uuid[]) order by snapshot_id`,
    [snapshotIds],
  )).rows.map((row) => row.snapshot_id);
}

test("0074 snapshot children", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "snapshot-children-0074");
  const db = await createDatabase(t, server, "snapshot_children_0074");
  await applyCanonicalSchema(db);

  await t.test("down then up rebuilds exactly what the canonical schema defines", async () => {
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0074", "down");
    await applyMigration(db, "0074", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
  });

  await t.test("deleting a parent deletes its child", async () => {
    const parent = await snapshot(db);
    const child = await snapshot(db, parent);
    await db.query(`delete from snapshots where snapshot_id = $1`, [parent]);
    assert.deepEqual(await remaining(db, [parent, child]), []);
  });

  await t.test("down restores the refusal to delete a parent with a child", async () => {
    await applyMigration(db, "0074", "down");
    const parent = await snapshot(db);
    const child = await snapshot(db, parent);
    await expectRejected(db, `delete from snapshots where snapshot_id = $1`, /snapshots_parent_snapshot_fkey/, [parent]);
    assert.deepEqual(await remaining(db, [parent, child]), [parent, child].sort());
    await applyMigration(db, "0074", "up");
  });
});
