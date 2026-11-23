import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, expectRejected, startServer } from "./financial-migration-helpers.ts";

const SOURCE = "0f000000-0000-4000-8000-0000000000c8";
const BLOB = `sha256:${"a".repeat(64)}`;

test("0088 documents raw blob transform", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "raw-blob-transform-0088");
  const db = await createDatabase(t, server, "raw_blob_transform_0088");
  await applyCanonicalSchema(db);
  await db.query(`insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at) values ('${SOURCE}', 'sec_edgar', 'filing', 'primary', 'public', now())`);
  const document = (transform: string) =>
    `insert into documents (source_id, kind, content_hash, raw_blob_id, raw_blob_transform) values ('${SOURCE}', 'filing', md5(random()::text), 'blob', ${transform})`;

  await t.test("a document's blob is stored as sent, or names the transform that made it", async () => {
    await db.query(document("null"));
    await db.query(document("'sec_uuencoded_bodies_removed.v1'"));
    await expectRejected(db, document("'gzip'"), /documents_raw_blob_transform_check/);
    await db.query(`insert into object_blob_gc_queue (raw_blob_id, reason) values ('${BLOB}', 'blob_rewrite')`);
    await expectRejected(db, `insert into object_blob_gc_queue (raw_blob_id, reason) values ('sha256:${"b".repeat(64)}', 'cleanup')`, /object_blob_gc_queue_reason_check/);
  });

  await t.test("down refuses while a rewritten blob would lose its transform", async () => {
    await assert.rejects(applyMigration(db, "0088", "down"), /cannot roll back 0088/);
    assert.equal((await db.query(`select count(*)::int as n from documents where raw_blob_transform is not null`)).rows[0].n, 1);
  });

  await t.test("down drops the column and rewrite deletions; up rebuilds what the canonical schema defines, and reruns cleanly", async () => {
    await db.query(`delete from documents`);
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0088", "down");
    assert.equal((await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'documents' and column_name = 'raw_blob_transform'`)).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int as n from object_blob_gc_queue`)).rows[0].n, 0);
    await applyMigration(db, "0088", "up");
    await applyMigration(db, "0088", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
  });
});
