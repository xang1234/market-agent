import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";

import { setTimeout as delay } from "node:timers/promises";

import { runObjectBlobGcBatchWithPool } from "../src/blob-gc-repo.ts";
import { ingestDocument } from "../src/ingest.ts";
import { rewriteFilingBlobs } from "../src/sec-blob-rewrite.ts";
import { stripUuencodedBodies } from "../src/sec-submission-strip.ts";
import { MemoryObjectStore, rawBlobIdFromBytes, type ObjectStore } from "../src/object-store.ts";
import { releaseExhibits } from "../src/sec-earnings-release-extraction.ts";
import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { RELEASE_SUBMISSION } from "./fixtures/sec-8k-release.ts";
import { JPEG_BYTES, uuencode } from "./fixtures/uuencode.ts";
import { waitForAdvisoryLockWaiter } from "./advisory-lock-waiter.ts";

const encoder = new TextEncoder();
const GRAPHIC = `<DOCUMENT>\n<TYPE>GRAPHIC\n<SEQUENCE>9\n<FILENAME>logo.jpg\n<TEXT>\n${uuencode("logo.jpg", JPEG_BYTES)}\n</TEXT>\n</DOCUMENT>`;
const withGraphic = (accession: string) =>
  encoder.encode(RELEASE_SUBMISSION.replace(/^<SEC-DOCUMENT>[^\n]*/, `<SEC-DOCUMENT>${accession}.txt`).replace("\n</SEC-DOCUMENT>", `\n${GRAPHIC}\n</SEC-DOCUMENT>`));

// The store as the code before #757 wrote it: SEC's bytes under their own hash.
async function seedVerbatim(db: Pool, store: MemoryObjectStore, sourceId: string, title: string, bytes: Uint8Array, stored = true) {
  const id = rawBlobIdFromBytes(bytes);
  if (stored) await store.put(bytes);
  const { rows: [row] } = await db.query<{ document_id: string }>(
    `insert into documents (source_id, kind, title, content_hash, raw_blob_id) values ($1, 'filing', $2, $3, $3) returning document_id::text`,
    [sourceId, title, id],
  );
  return { documentId: row!.document_id, id };
}

async function cite(db: Pool, sourceId: string, documentId: string, locator: Record<string, unknown>) {
  const { rows: [claim] } = await db.query<{ claim_id: string }>(
    `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, confidence, status)
     values ($1, 'guidance.outlook', 'A quote.', 'neutral', 'quoted', $2, 0.8, 'extracted') returning claim_id::text`,
    [documentId, sourceId],
  );
  await db.query(`insert into claim_evidence (claim_id, document_id, locator, excerpt_hash, confidence) values ($1, $2, $3, 'hash', 1)`, [claim!.claim_id, documentId, locator]);
}

test("the rewrite strips stored submissions in place, keeps what offsets cite, and converges across runs (#757)", async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "sec-blob-rewrite");
  const db = await connectedPool(t, databaseUrl, { max: 10 });
  const store = new MemoryObjectStore();
  let failDeletes = 1;
  const flakyStore: ObjectStore = {
    put: (bytes) => store.put(bytes),
    get: (id) => store.get(id),
    has: (id) => store.has(id),
    delete: async (id) => {
      if (failDeletes-- > 0) throw new Error("network down");
      return store.delete(id);
    },
  };
  const { rows: [source] } = await db.query<{ source_id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at) values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id::text`,
  );
  const sourceId = source!.source_id;

  const releaseBytes = withGraphic("0009999999-25-000001");
  const release = await seedVerbatim(db, store, sourceId, "8-K", releaseBytes);
  await cite(db, sourceId, release.documentId, { exhibit: "EX-99.1", start: 0, end: 10, text_basis: "sec_exhibit_canonical_text.v1" });
  const quoted = await seedVerbatim(db, store, sourceId, "8-K", withGraphic("0009999999-25-000002"));
  await cite(db, sourceId, quoted.documentId, { kind: "normalized_text", offset_start: 900, offset_end: 950 });
  await seedVerbatim(db, store, sourceId, "10-K", encoder.encode("<html><body>Item 1. Business</body></html>"));
  await seedVerbatim(db, store, sourceId, "8-K/A", withGraphic("0009999999-25-000003"), false);
  const strippedBytes = releaseBytes.length - GRAPHIC.indexOf("end\n") - 4 + GRAPHIC.indexOf("begin");
  const documents = async () => (await db.query(`select document_id::text, content_hash, raw_blob_id, raw_blob_transform from documents order by document_id`)).rows;
  const before = await documents();

  const dry = await rewriteFilingBlobs({ db, objectStore: flakyStore }, { dryRun: true });
  assert.deepEqual(dry.forms["8-K"], { documents: 2, stripped: 1, cited: 1, verbatim: 0, missing: 0, raced: 0, failed: 0, bytes_before: releaseBytes.length * 2, bytes_after: releaseBytes.length + strippedBytes });
  assert.deepEqual(dry.forms["10-K"], { documents: 1, stripped: 0, cited: 0, verbatim: 1, missing: 0, raced: 0, failed: 0, bytes_before: 42, bytes_after: 42 });
  assert.equal(dry.forms["8-K/A"]?.missing, 1);
  assert.deepEqual(await documents(), before, "a dry run writes nothing");
  assert.equal(await store.has(release.id), true);

  const real = await rewriteFilingBlobs({ db, objectStore: flakyStore }, { dryRun: false });
  assert.deepEqual(real.forms["8-K"], dry.forms["8-K"]);
  assert.deepEqual({ deleted: real.blobs_deleted, failed: real.blob_deletes_failed }, { deleted: 0, failed: 1 });
  const { rows: [moved] } = await db.query(`select content_hash, raw_blob_id, raw_blob_transform from documents where document_id = $1`, [release.documentId]);
  const stripped = (await store.get(moved.raw_blob_id))!.bytes;
  assert.equal(stripped.length, strippedBytes);
  assert.deepEqual(moved, { content_hash: release.id, raw_blob_id: rawBlobIdFromBytes(stripped), raw_blob_transform: "sec_uuencoded_bodies_removed.v1" });
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  assert.deepEqual(releaseExhibits(decode(stripped)), releaseExhibits(decode(releaseBytes)));
  assert.deepEqual((await documents()).filter((row) => row.document_id !== release.documentId), before.filter((row) => row.document_id !== release.documentId), "cited, verbatim and missing documents keep their blob");
  assert.equal(await store.has(quoted.id), true);
  assert.equal(await store.has(release.id), true, "the failed delete left SEC's bytes, queued");

  await db.query(`update object_blob_gc_queue set next_attempt_at = now()`); // the backoff passes
  const rerun = await rewriteFilingBlobs({ db, objectStore: flakyStore }, { dryRun: false });
  assert.equal(rerun.forms["8-K"]?.stripped, 0);
  assert.equal(rerun.forms["8-K"]?.cited, 1);
  assert.equal(rerun.blobs_deleted, 1, "the next run deletes the blob the last one could not");
  assert.equal(await store.has(release.id), false);
  assert.equal(await store.has(moved.raw_blob_id), true);
});

async function secSource(db: Pool): Promise<string> {
  const { rows: [source] } = await db.query<{ source_id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at) values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id::text`,
  );
  return source!.source_id;
}

test("a GC batch while the rewrite stores the stripped copy cannot delete it from under the document", async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "sec-blob-rewrite-gc-race");
  const db = await connectedPool(t, databaseUrl, { max: 10 });
  const store = new MemoryObjectStore();
  const bytes = withGraphic("0009999999-25-000010");
  const seeded = await seedVerbatim(db, store, await secSource(db), "8-K", bytes);
  const strippedId = rawBlobIdFromBytes(stripUuencodedBodies(bytes)!);
  let gc: Promise<unknown> | undefined;
  const racing: ObjectStore = {
    put: async (put) => {
      const result = await store.put(put);
      if (result.blob.raw_blob_id === strippedId && gc === undefined) {
        // An earlier run's raced copy of the same bytes, queued and drained now.
        await db.query(`insert into object_blob_gc_queue (raw_blob_id, reason) values ($1, 'blob_rewrite')`, [strippedId]);
        gc = runObjectBlobGcBatchWithPool(db, store);
        await Promise.race([gc, delay(500)]);
      }
      return result;
    },
    get: (id) => store.get(id),
    has: (id) => store.has(id),
    delete: (id) => store.delete(id),
  };

  const report = await rewriteFilingBlobs({ db, objectStore: racing }, { dryRun: false });
  await gc;
  assert.equal(report.forms["8-K"]?.stripped, 1);
  const { rows: [document] } = await db.query(`select raw_blob_id from documents where document_id = $1`, [seeded.documentId]);
  assert.equal(document.raw_blob_id, strippedId);
  assert.equal(await store.has(strippedId), true, "the document names stored bytes");
});

test("a run tries each queued deletion once, backs off a failure, and pages past blobs still named", async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "sec-blob-rewrite-drain");
  const db = await connectedPool(t, databaseUrl, { max: 10 });
  const store = new MemoryObjectStore();
  const broken = (await store.put(encoder.encode("a blob the store will not delete"))).blob.raw_blob_id;
  const free = (await store.put(encoder.encode("a blob nothing names"))).blob.raw_blob_id;
  let brokenAttempts = 0;
  const objectStore: ObjectStore = {
    put: (bytes) => store.put(bytes),
    get: (id) => store.get(id),
    has: (id) => store.has(id),
    delete: async (id) => {
      if (id !== broken) return store.delete(id);
      brokenAttempts += 1;
      throw new Error("access denied");
    },
  };
  const sourceId = await secSource(db);
  // A full GC batch of blobs still named by a document leads the queue.
  await db.query(
    `insert into documents (source_id, kind, title, content_hash, raw_blob_id, raw_blob_transform)
     select $1, 'filing', '8-K', 'sha256:' || encode(sha256(('sent' || i)::bytea), 'hex'), 'sha256:' || encode(sha256(i::text::bytea), 'hex'), 'sec_uuencoded_bodies_removed.v1'
       from generate_series(1, 100) i`,
    [sourceId],
  );
  await db.query(
    `insert into object_blob_gc_queue (raw_blob_id, reason, next_attempt_at)
     select raw_blob_id, 'blob_rewrite', now() - interval '1 hour' from documents
     union all select $1, 'blob_rewrite', now() - interval '30 minutes'
     union all select $2, 'blob_rewrite', now() - interval '10 minutes'`,
    [broken, free],
  );
  for (const accession of ["0009999999-25-000021", "0009999999-25-000022", "0009999999-25-000023"]) {
    await seedVerbatim(db, store, sourceId, "8-K", withGraphic(accession));
  }

  const run = await rewriteFilingBlobs({ db, objectStore }, { dryRun: false, pageSize: 1 });
  assert.equal(run.forms["8-K"]?.stripped, 3);
  assert.equal(brokenAttempts, 1, "once per run, across every page's drain");
  assert.equal(await store.has(free), false, "the drain reached past the blobs still named");
  assert.deepEqual({ deleted: run.blobs_deleted, failed: run.blob_deletes_failed }, { deleted: 4, failed: 1 });
  const { rows: [due] } = await db.query(`select next_attempt_at > now() + interval '30 seconds' as later from object_blob_gc_queue where raw_blob_id = $1`, [broken]);
  assert.equal(due.later, true, "a failure waits before its next try");

  await rewriteFilingBlobs({ db, objectStore }, { dryRun: false });
  assert.equal(brokenAttempts, 1, "a run inside the backoff leaves it");
});

test("a rewrite that fails after storing the stripped copy deletes it before another ingest can name it", async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "sec-blob-rewrite-rollback-race");
  const db = await connectedPool(t, databaseUrl, { max: 10 });
  const store = new MemoryObjectStore();
  const sourceId = await secSource(db);
  const bytes = withGraphic("0009999999-25-000030");
  await seedVerbatim(db, store, sourceId, "8-K", bytes);
  const stripped = stripUuencodedBodies(bytes)!;
  const strippedId = rawBlobIdFromBytes(stripped);
  // The rewrite's update fails, after its put and while it holds the lock.
  await db.query(`create function fail_update() returns trigger language plpgsql as $$ begin raise exception 'update fails'; end $$`);
  await db.query(`create trigger fail_update before update on documents for each row execute function fail_update()`);
  let other: Promise<{ raw_blob_id: string }> | undefined;
  const racing: ObjectStore = {
    put: async (put) => {
      const result = await store.put(put);
      if (result.blob.raw_blob_id === strippedId && other === undefined) {
        // An ingest of the same bytes queues behind the rewrite's lock.
        other = ingestDocument({ db, objectStore: racing }, {
          source: { source_id: sourceId, license_class: "public" },
          bytes: stripped,
          document: { kind: "filing", title: "8-K" },
        });
        await waitForAdvisoryLockWaiter(db);
      }
      return result;
    },
    get: (id) => store.get(id),
    has: (id) => store.has(id),
    delete: async (id) => {
      await Promise.race([other, delay(500)]);
      return store.delete(id);
    },
  };

  const report = await rewriteFilingBlobs({ db, objectStore: racing }, { dryRun: false });
  assert.equal(report.forms["8-K"]?.failed, 1);
  const named = await other!;
  assert.equal(named.raw_blob_id, strippedId);
  assert.equal(await store.has(strippedId), true, "the ingest's document names stored bytes");
});

test("a queued blob the first drain found still named is deleted in the same run once the rewrite frees it", async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "sec-blob-rewrite-requeue");
  const db = await connectedPool(t, databaseUrl, { max: 10 });
  const store = new MemoryObjectStore();
  const seeded = await seedVerbatim(db, store, await secSource(db), "8-K", withGraphic("0009999999-25-000040"));
  // Queued by an earlier run that crashed before it moved the document.
  await db.query(`insert into object_blob_gc_queue (raw_blob_id, reason) values ($1, 'blob_rewrite')`, [seeded.id]);

  const run = await rewriteFilingBlobs({ db, objectStore: store }, { dryRun: false });
  assert.equal(run.forms["8-K"]?.stripped, 1);
  assert.equal(run.blobs_deleted, 1);
  assert.equal(await store.has(seeded.id), false);
});
