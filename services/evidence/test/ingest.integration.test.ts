import test from "node:test";
import assert from "node:assert/strict";

import { ingestDocument } from "../src/ingest.ts";
import { EPHEMERAL_RAW_BLOB_ID_PREFIX, rawBlobIdFromBytes } from "../src/object-store.ts";
import { createSource } from "../src/source-repo.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";
import { RecordingObjectStore } from "./recording-object-store.ts";
import { JPEG_BYTES, uuencode } from "./fixtures/uuencode.ts";

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

    // Stored as SEC sent it: before #757, or kept whole because an offset cites it.
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

    // Stored stripped: ingested after #757, or rewritten.
    const fresh = submission("0009999999-25-000002");
    const first = await ingest(fresh);
    const second = await ingest(fresh);
    assert.equal(second.document.document_id, first.document.document_id);
    assert.equal((await documentsNamed(rawBlobIdFromBytes(fresh))).length, 1);
  },
);
