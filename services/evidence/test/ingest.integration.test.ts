import test from "node:test";
import assert from "node:assert/strict";

import { setTimeout as delay } from "node:timers/promises";

import { ingestDocument, ingestDocumentInTransaction } from "../src/ingest.ts";
import { EPHEMERAL_RAW_BLOB_ID_PREFIX, MemoryObjectStore, rawBlobIdFromBytes, type ObjectStore } from "../src/object-store.ts";
import { withTransaction } from "../src/transaction.ts";
import { createSource } from "../src/source-repo.ts";
import {
  bootstrapDatabase,
  connectedClient,
  connectedPool,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";
import { RecordingObjectStore } from "./recording-object-store.ts";
import { JPEG_BYTES, uuencode } from "./fixtures/uuencode.ts";
import { waitForAdvisoryLockWaiter } from "./advisory-lock-waiter.ts";

// End-to-end against real Postgres: documents row must persist with
// the ephemeral sentinel as raw_blob_id (NOT NULL, no unique-index
// collision) while the object store stays untouched.
test(
  "end-to-end: tweet with license_class='ephemeral' lands a documents row but no blob",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "ingest-fra-0sa");
    const client = await connectedClient(t, databaseUrl);
    const objectStore = new RecordingObjectStore();

    // Real source row with the restrictive license class.
    const source = await createSource(client, {
      provider: "twitter",
      kind: "social_post",
      canonical_url: "https://twitter.com/example/status/1",
      trust_tier: "tertiary",
      license_class: "ephemeral",
      retrieved_at: "2026-05-02T00:00:00Z",
    });

    const tweetBytes = new TextEncoder().encode("$AAPL crushes Q1 — bullish setup");
    const result = await ingestDocument(
      { db: client, objectStore },
      {
        source: { source_id: source.source_id, license_class: source.license_class },
        bytes: tweetBytes,
        document: {
          kind: "social_post",
          provider_doc_id: "twitter:1",
          author: "@example",
        },
      },
    );

    assert.equal(result.status, "ephemeral");
    assert.equal(
      result.raw_blob_id,
      `${EPHEMERAL_RAW_BLOB_ID_PREFIX}${source.source_id}`,
      "raw_blob_id must be the ephemeral sentinel",
    );
    assert.equal(objectStore.putCalls, 0, "object store must not have been called");

    // The bead's headline assertion: the documents row exists, it's
    // attributable (source_id, content_hash, provider_doc_id all populated),
    // and raw_blob_id is the sentinel — never a real blob handle.
    const { rows } = await client.query<{
      raw_blob_id: string;
      content_hash: string;
      kind: string;
      provider_doc_id: string;
    }>(
      `select raw_blob_id, content_hash, kind, provider_doc_id
         from documents
        where document_id = $1::uuid`,
      [result.document.document_id],
    );
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].raw_blob_id,
      `${EPHEMERAL_RAW_BLOB_ID_PREFIX}${source.source_id}`,
      "documents.raw_blob_id stored the sentinel",
    );
    assert.equal(rows[0].kind, "social_post");
    assert.equal(rows[0].provider_doc_id, "twitter:1");
    assert.match(rows[0].content_hash, /^sha256:[0-9a-f]{64}$/, "content_hash is sha256-derived even on the ephemeral path");
  },
);

test(
  "end-to-end: reddit post with license_class='public' stores blob and lands documents row with sha256 raw_blob_id",
  { skip: !dockerAvailable() },
  async (t) => {
    // Permissive companion to the headline test — proves the gating is
    // license-driven, not source-kind-driven (a reddit social_post under
    // a permissive license class still gets stored).
    const { databaseUrl } = await bootstrapDatabase(t, "ingest-fra-0sa-permissive");
    const client = await connectedClient(t, databaseUrl);
    const objectStore = new RecordingObjectStore();

    const source = await createSource(client, {
      provider: "reddit",
      kind: "social_post",
      canonical_url: "https://reddit.com/r/stocks/comments/abc",
      trust_tier: "tertiary",
      license_class: "public",
      retrieved_at: "2026-05-02T00:00:00Z",
    });

    const postBytes = new TextEncoder().encode("DD: Apple's services growth is structural");
    const result = await ingestDocument(
      { db: client, objectStore },
      {
        source: { source_id: source.source_id, license_class: source.license_class },
        bytes: postBytes,
        document: {
          kind: "social_post",
          provider_doc_id: "reddit:t3_abc",
          author: "u/example",
        },
      },
    );

    assert.equal(result.status, "blob_stored");
    assert.match(result.raw_blob_id, /^sha256:[0-9a-f]{64}$/);
    assert.equal(objectStore.putCalls, 1);
    assert.equal(await objectStore.has(result.raw_blob_id), true, "blob is retrievable from object store after permissive ingest");

    const { rows } = await client.query<{
      raw_blob_id: string;
      content_hash: string;
      kind: string;
      provider_doc_id: string;
    }>(
      `select raw_blob_id, content_hash, kind, provider_doc_id
         from documents
        where document_id = $1::uuid`,
      [result.document.document_id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].raw_blob_id, result.raw_blob_id);
    assert.equal(rows[0].kind, "social_post");
    assert.equal(rows[0].provider_doc_id, "reddit:t3_abc");
    assert.match(rows[0].content_hash, /^sha256:[0-9a-f]{64}$/);
  },
);

test(
  "re-ingesting a filing finds its document by content_hash, whichever blob it is stored as (#757)",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "ingest-filing-dedupe");
    const client = await connectedClient(t, databaseUrl);
    const objectStore = new RecordingObjectStore();
    const source = await createSource(client, {
      provider: "sec_edgar",
      kind: "filing",
      trust_tier: "primary",
      license_class: "public",
      retrieved_at: "2026-11-23T00:00:00Z",
    });
    const submission = (accession: string) => new TextEncoder().encode(
      `<SEC-DOCUMENT>${accession}.txt\n<DOCUMENT>\n<TYPE>8-K\n<TEXT>\n<html>Item 2.02</html>\n</TEXT>\n</DOCUMENT>\n` +
        `<DOCUMENT>\n<TYPE>GRAPHIC\n<FILENAME>logo.jpg\n<TEXT>\n${uuencode("logo.jpg", JPEG_BYTES)}\n</TEXT>\n</DOCUMENT>\n</SEC-DOCUMENT>\n`,
    );
    const ingest = (bytes: Uint8Array) => ingestDocument({ db: client, objectStore }, {
      source: { source_id: source.source_id, license_class: source.license_class },
      bytes,
      document: { kind: "filing", provider_doc_id: "0009999999-25-000001", title: "8-K" },
    });
    const documentsNamed = async (contentHash: string) =>
      (await client.query(`select document_id::text, raw_blob_id from documents where content_hash = $1`, [contentHash])).rows;

    // Stored as SEC sent it, before #757 or kept whole because an offset cites it.
    const sent = submission("0009999999-25-000001");
    const sentId = rawBlobIdFromBytes(sent);
    await objectStore.put(sent);
    const { rows: [verbatim] } = await client.query(
      `insert into documents (source_id, kind, title, content_hash, raw_blob_id) values ($1, 'filing', '8-K', $2, $2) returning document_id::text`,
      [source.source_id, sentId],
    );
    const again = await ingest(sent);
    assert.equal(again.document.document_id, verbatim.document_id);
    assert.deepEqual(await documentsNamed(sentId), [{ document_id: verbatim.document_id, raw_blob_id: sentId }]);

    // Stored stripped, ingested after #757 or rewritten.
    const fresh = submission("0009999999-25-000002");
    const first = await ingest(fresh);
    const second = await ingest(fresh);
    assert.equal(second.document.document_id, first.document.document_id);
    assert.equal((await documentsNamed(rawBlobIdFromBytes(fresh))).length, 1);
  },
);

const SEC_SOURCE = { provider: "sec_edgar", kind: "filing", trust_tier: "primary", license_class: "public", retrieved_at: "2026-11-23T00:00:00Z" } as const;
const submissionWithGraphic = (accession: string) => new TextEncoder().encode(
  `<SEC-DOCUMENT>${accession}.txt\n<DOCUMENT>\n<TYPE>8-K\n<TEXT>\n<html>Item 2.02</html>\n</TEXT>\n</DOCUMENT>\n` +
    `<DOCUMENT>\n<TYPE>GRAPHIC\n<FILENAME>logo.jpg\n<TEXT>\n${uuencode("logo.jpg", JPEG_BYTES)}\n</TEXT>\n</DOCUMENT>\n</SEC-DOCUMENT>\n`,
);

test(
  "a filing ingest never returns, or shares, a user's upload or another kind's document with the same bytes (#757)",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "ingest-filing-dedupe-scope");
    const client = await connectedClient(t, databaseUrl);
    const objectStore = new RecordingObjectStore();
    const sec = await createSource(client, SEC_SOURCE);
    const { rows: [user] } = await client.query(`insert into users (email) values ('uploader@example.test') returning user_id::text`);
    const ingest = (source: { source_id: string; license_class: string }, bytes: Uint8Array, kind: "filing" | "upload" | "press_release") =>
      ingestDocument({ db: client, objectStore }, { source, bytes, document: { kind, title: kind } });
    const upload = async (bytes: Uint8Array) => {
      const source = await createSource(client, { provider: "user_upload", kind: "upload", trust_tier: "user", license_class: "user_private", retrieved_at: "2026-11-23T00:00:00Z", user_id: user.user_id });
      return ingest(source, bytes, "upload");
    };
    const secFiling = (bytes: Uint8Array) => ingest(sec, bytes, "filing");

    // (a) A user uploads the .txt, then SEC ingest of the same filing runs.
    const a = submissionWithGraphic("0009999999-25-000101");
    const uploadA = await upload(a);
    const filingA = await secFiling(a);
    assert.notEqual(filingA.document.document_id, uploadA.document.document_id);
    assert.equal(filingA.document.source_id, sec.source_id);

    // (b) The filing is stored first; a user's upload of it must not take its place.
    const b = submissionWithGraphic("0009999999-25-000102");
    const filingB = await secFiling(b);
    const uploadB = await upload(b);
    assert.notEqual(uploadB.document.document_id, filingB.document.document_id);
    assert.equal((await secFiling(b)).document.document_id, filingB.document.document_id);

    // (c) A press release that is the same bytes is another kind's document.
    const c = submissionWithGraphic("0009999999-25-000103");
    const release = await ingest(sec, c, "press_release");
    const filingC = await secFiling(c);
    assert.notEqual(filingC.document.document_id, release.document.document_id);
    assert.equal(filingC.document.kind, "filing");

    await client.query(`delete from users where user_id = $1`, [user.user_id]);
    const { rows } = await client.query(`select document_id::text from documents where document_id = any($1::uuid[])`, [[filingA.document.document_id, filingB.document.document_id]]);
    assert.equal(rows.length, 2, "erasing the user leaves the public filings");
  },
);

test(
  "a caller's rollback cannot delete a blob another ingest named once the lock was free",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "ingest-rollback-cleanup-race");
    const db = await connectedPool(t, databaseUrl, { max: 5 });
    const inner = new MemoryObjectStore();
    let other: Promise<unknown> | undefined;
    const objectStore: ObjectStore = {
      put: (bytes) => inner.put(bytes),
      get: (id) => inner.get(id),
      has: (id) => inner.has(id),
      // A slow delete, so the other ingest gets as far as it can first.
      delete: async (id) => {
        await Promise.race([other, delay(500)]);
        return inner.delete(id);
      },
    };
    const sec = await createSource(db, SEC_SOURCE);
    const input = { source: sec, bytes: new TextEncoder().encode("<html>A press release.</html>"), document: { kind: "press_release" as const, title: "PR" } };

    await assert.rejects(withTransaction(db, async (tx) => {
      await ingestDocumentInTransaction({ tx, objectStore }, input);
      other = ingestDocument({ db, objectStore }, input);
      await waitForAdvisoryLockWaiter(db);
      throw new Error("the caller fails after its ingest");
    }), /the caller fails/);
    const named = (await other) as { raw_blob_id: string };
    assert.equal(await inner.has(named.raw_blob_id), true, "the committed document names a stored blob");
  },
);

test(
  "an ingest whose insert fails cannot delete a blob another ingest named once the failure freed the lock",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "ingest-insert-failure-race");
    const db = await connectedPool(t, databaseUrl, { max: 5 });
    const inner = new MemoryObjectStore();
    // Postgres frees a transaction's locks as soon as one of its statements fails.
    await db.query(`create function fail_insert() returns trigger language plpgsql as $$ begin raise exception 'insert fails'; end $$`);
    await db.query(`create trigger fail_insert before insert on documents for each row when (new.title = 'fails') execute function fail_insert()`);
    const sec = await createSource(db, SEC_SOURCE);
    const bytes = new TextEncoder().encode("<html>Another press release.</html>");
    const ingest = (title: string) => ingestDocument({ db, objectStore }, { source: sec, bytes, document: { kind: "press_release", title } });
    let other: Promise<{ raw_blob_id: string }> | undefined;
    const objectStore: ObjectStore = {
      put: async (put) => {
        const result = await inner.put(put);
        if (other === undefined) {
          other = ingest("succeeds");
          await waitForAdvisoryLockWaiter(db);
        }
        return result;
      },
      get: (id) => inner.get(id),
      has: (id) => inner.has(id),
      delete: async (id) => {
        await Promise.race([other, delay(500)]);
        return inner.delete(id);
      },
    };

    await assert.rejects(ingest("fails"), /insert fails/);
    const named = await other!;
    assert.equal(await inner.has(named.raw_blob_id), true, "the committed document names a stored blob");
  },
);
