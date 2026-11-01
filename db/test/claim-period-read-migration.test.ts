import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, IDS, seedLegacyEvidence, startServer } from "./financial-migration-helpers.ts";

const DOCUMENT = "0f000000-0000-4000-8000-0000000000f5";

test("0075 claim period read mark", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "claim-period-read-0075");
  const db = await createDatabase(t, server, "claim_period_read_0075");
  await applyCanonicalSchema(db);
  await seedLegacyEvidence(db);
  await db.query(
    `insert into documents (document_id, source_id, kind, content_hash, raw_blob_id) values ($1, $2, 'filing', 'hash-0075', 'sha256:0075')`,
    [DOCUMENT, IDS.publicSource],
  );
  const marks = async () =>
    (await db.query(`select enriched_at is not null as enriched, period_read_at is not null as read from claims where document_id = $1`, [DOCUMENT])).rows;

  await t.test("a claim's period read mark is its own column, set apart from enriched_at", async () => {
    await db.query(
      `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, confidence, status, period_read_at)
       values ($1, 'management.explanation.gross_margin', 'Gross margin fell on an inventory charge.', 'negative', 'asserted', $2, 0.9, 'extracted', now())`,
      [DOCUMENT, IDS.publicSource],
    );
    assert.deepEqual(await marks(), [{ enriched: false, read: true }]);
  });

  await t.test("down drops the mark and keeps the claim; up rebuilds what the canonical schema defines, and reruns cleanly", async () => {
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0075", "down");
    assert.deepEqual(
      (await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'claims' and column_name = 'period_read_at'`)).rows,
      [{ n: 0 }],
    );
    assert.equal((await db.query(`select count(*)::int as n from claims where document_id = $1`, [DOCUMENT])).rows[0].n, 1);
    await applyMigration(db, "0075", "up");
    await applyMigration(db, "0075", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
    assert.deepEqual(await marks(), [{ enriched: false, read: false }]);
  });
});
