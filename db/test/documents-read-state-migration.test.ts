import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, expectRejected, startServer } from "./financial-migration-helpers.ts";

const SOURCE = "0f000000-0000-4000-8000-0000000000c4";

test("0084 documents read state", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "documents-read-state-0084");
  const db = await createDatabase(t, server, "documents_read_state_0084");
  await applyCanonicalSchema(db);
  await db.query(`insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at) values ('${SOURCE}', 'sec_edgar', 'filing', 'primary', 'public', now())`);
  const document = (readState: string) =>
    `insert into documents (source_id, kind, content_hash, raw_blob_id, read_state) values ('${SOURCE}', 'filing', md5(random()::text), 'blob', ${readState})`;

  await t.test("a document's read state is null or an object keyed by item", async () => {
    await db.query(document("null"));
    await db.query(document(`'{"1": {"state": "read"}, "1A": {"state": "cut", "prompts": 11, "of": 13}}'`));
    assert.deepEqual(
      (await db.query(`select read_state->'1A' as item from documents where read_state is not null`)).rows,
      [{ item: { state: "cut", prompts: 11, of: 13 } }],
    );
    await expectRejected(db, document(`'["read"]'`), /documents_read_state_check/);
  });

  await t.test("down drops the column; up rebuilds what the canonical schema defines", async () => {
    await db.query(`delete from documents`);
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0084", "down");
    assert.equal((await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'documents' and column_name = 'read_state'`)).rows[0].n, 0);
    await applyMigration(db, "0084", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
  });
});
