import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { rewriteFilingBlobs } from "../src/sec-blob-rewrite.ts";
import { MemoryObjectStore, rawBlobIdFromBytes, type ObjectStore } from "../src/object-store.ts";
import { releaseExhibits } from "../src/sec-earnings-release-extraction.ts";
import { bootstrapDatabase, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { RELEASE_SUBMISSION } from "./fixtures/sec-8k-release.ts";

const encoder = new TextEncoder();
const GRAPHIC = "<DOCUMENT>\n<TYPE>GRAPHIC\n<SEQUENCE>9\n<FILENAME>logo.jpg\n<TEXT>\nbegin 644 logo.jpg\nM_]C_X  02D9)1@ ! 0$ 8 !@  #_VP!#  ,\" @,\" @,# P,$ P,$!0@%!00$\n`\nend\n</TEXT>\n</DOCUMENT>";
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
  const db = new Pool({ connectionString: databaseUrl });
  t.after(() => db.end());
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

  const rerun = await rewriteFilingBlobs({ db, objectStore: flakyStore }, { dryRun: false });
  assert.equal(rerun.forms["8-K"]?.stripped, 0);
  assert.equal(rerun.forms["8-K"]?.cited, 1);
  assert.equal(rerun.blobs_deleted, 1, "the next run deletes the blob the last one could not");
  assert.equal(await store.has(release.id), false);
  assert.equal(await store.has(moved.raw_blob_id), true);
});
