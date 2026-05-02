import test from "node:test";
import assert from "node:assert/strict";

import { ingestDocument } from "../src/ingest.ts";
import {
  EPHEMERAL_RAW_BLOB_ID_PREFIX,
  MemoryObjectStore,
  type ObjectStore,
  type PutResult,
  type StoredBlob,
} from "../src/object-store.ts";
import { createSource } from "../src/source-repo.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

class RecordingObjectStore implements ObjectStore {
  putCalls = 0;
  readonly inner = new MemoryObjectStore();
  async put(bytes: Uint8Array): Promise<PutResult> {
    this.putCalls += 1;
    return this.inner.put(bytes);
  }
  async get(rawBlobId: string): Promise<StoredBlob | null> {
    return this.inner.get(rawBlobId);
  }
  async has(rawBlobId: string): Promise<boolean> {
    return this.inner.has(rawBlobId);
  }
}

// fra-0sa BEAD VERIFICATION (end-to-end): "Ingest with restrictive
// license; no blob written."
//
// The unit test in ingest.test.ts proves the orchestrator's branching;
// this test proves the documents row actually persists with the
// ephemeral sentinel against real Postgres (the schema kept
// raw_blob_id NOT NULL — the sentinel must satisfy that constraint
// without falling foul of any check or unique index).
test(
  "end-to-end: tweet with license_class='ephemeral' lands a documents row but no blob (fra-0sa)",
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
  },
);
