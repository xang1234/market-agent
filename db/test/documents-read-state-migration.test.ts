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

  await t.test("up records as read each 10-K item whose claims have evidence", async () => {
    await applyMigration(db, "0084", "down");
    const { rows: [tenK] } = await db.query(
      `insert into documents (source_id, kind, title, content_hash, raw_blob_id) values ('${SOURCE}', 'filing', '10-K', 'ten-k', 'blob') returning document_id`,
    );
    const { rows: [other] } = await db.query(
      `insert into documents (source_id, kind, title, content_hash, raw_blob_id) values ('${SOURCE}', 'filing', '8-K', 'eight-k', 'blob') returning document_id`,
    );
    for (const [document, locator] of [
      [tenK.document_id, { item: "1A", start: 0, end: 40, text_basis: "sec_10k_item_canonical_text.v1" }],
      [tenK.document_id, { item: "1A", start: 50, end: 90, text_basis: "sec_10k_item_canonical_text.v1" }],
      [other.document_id, { exhibit: "99.1", start: 0, end: 40, text_basis: "sec_8k_exhibit_canonical_text.v1" }],
    ]) {
      const { rows: [claim] } = await db.query(
        `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, confidence, status)
         values ($1, 'risk.factor', 'A risk.', 'negative', 'quoted', '${SOURCE}', 0.8, 'extracted') returning claim_id`,
        [document],
      );
      await db.query(`insert into claim_evidence (claim_id, document_id, locator, excerpt_hash, confidence) values ($1, $2, $3, 'hash', 1)`, [claim.claim_id, document, locator]);
    }
    await applyMigration(db, "0084", "up");
    assert.deepEqual(
      (await db.query(`select title, read_state from documents order by title`)).rows,
      [{ title: "10-K", read_state: { "1A": { state: "read" } } }, { title: "8-K", read_state: null }],
    );
  });
});
