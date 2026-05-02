import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { ingestDocument } from "../src/ingest.ts";
import { LicensePolicyError } from "../src/license-policy.ts";
import {
  EPHEMERAL_RAW_BLOB_ID_PREFIX,
  MemoryObjectStore,
  type ObjectStore,
  type PutResult,
  type StoredBlob,
  ephemeralRawBlobIdForSource,
  rawBlobIdFromBytes,
} from "../src/object-store.ts";
import type { QueryExecutor } from "../src/types.ts";

const SOURCE_ID = "11111111-1111-4111-a111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-a222-222222222222";
const TWEET_BYTES = new TextEncoder().encode("$AAPL crushes Q1 — bullish setup");
const TWEET_HASH = `sha256:${createHash("sha256").update(TWEET_BYTES).digest("hex")}`;

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

function recordingDb() {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: [
          {
            inserted: true,
            document_id: DOCUMENT_ID,
            source_id: SOURCE_ID,
            provider_doc_id: values?.[1] ?? null,
            kind: values?.[2] ?? "social_post",
            parent_document_id: null,
            conversation_id: null,
            title: null,
            author: values?.[6] ?? null,
            published_at: null,
            lang: null,
            content_hash: values?.[9],
            raw_blob_id: values?.[10],
            parse_status: "pending",
            deleted_at: null,
            created_at: new Date("2026-05-02T00:00:00.000Z"),
            updated_at: new Date("2026-05-02T00:00:00.000Z"),
          },
        ] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

// fra-0sa: Permissive license — blob is stored, raw_blob_id is the
// content-derived sha256 hash. This is the "everything works as before
// fra-0sa" path; if it breaks, license gating broke the existing
// non-restrictive ingest flow.
test("permissive license_class 'public' stores the blob and uses the sha256 raw_blob_id", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  const result = await ingestDocument(
    { db, objectStore },
    {
      source: { source_id: SOURCE_ID, license_class: "public" },
      bytes: TWEET_BYTES,
      document: { kind: "social_post", author: "@trader" },
    },
  );

  assert.equal(result.status, "blob_stored");
  assert.equal(result.raw_blob_id, TWEET_HASH);
  assert.equal(result.document.raw_blob_id, TWEET_HASH);
  assert.equal(result.document.content_hash, TWEET_HASH);
  assert.equal(objectStore.putCalls, 1, "permissive path must call objectStore.put exactly once");
  assert.equal(await objectStore.has(TWEET_HASH), true, "blob must be retrievable after permissive ingest");
  assert.match(queries[0]?.text ?? "", /insert into documents/);
});

// fra-0sa BEAD VERIFICATION: "Ingest with restrictive license; no blob
// written." This is the headline assertion of the bead.
test("ephemeral license_class 'ephemeral' skips blob storage and uses the ephemeral sentinel raw_blob_id", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  const result = await ingestDocument(
    { db, objectStore },
    {
      source: { source_id: SOURCE_ID, license_class: "ephemeral" },
      bytes: TWEET_BYTES,
      document: { kind: "social_post", author: "@trader" },
    },
  );

  assert.equal(result.status, "ephemeral");
  assert.equal(result.raw_blob_id, ephemeralRawBlobIdForSource(SOURCE_ID));
  assert.equal(result.document.raw_blob_id, ephemeralRawBlobIdForSource(SOURCE_ID));
  assert.equal(result.document.content_hash, TWEET_HASH, "content_hash is still computed from bytes for dedupe + provenance");
  assert.equal(objectStore.putCalls, 0, "ephemeral path must NOT call objectStore.put — this is the bead verification");
  assert.equal(await objectStore.has(TWEET_HASH), false, "no blob must exist in object store after ephemeral ingest");
  assert.match(queries[0]?.text ?? "", /insert into documents/);
  assert.equal(queries[0]?.values?.[10], ephemeralRawBlobIdForSource(SOURCE_ID), "raw_blob_id passed to insert must be the sentinel");
});

test("unknown license_class throws LicensePolicyError before touching object store or db", async () => {
  // Fail-closed: if the policy module doesn't recognize the class, the
  // safest outcome is to refuse the ingest entirely. Verifies no
  // partial state is left behind (no blob put, no db query).
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestDocument(
      { db, objectStore },
      {
        source: { source_id: SOURCE_ID, license_class: "publik" /* typo */ },
        bytes: TWEET_BYTES,
        document: { kind: "social_post" },
      },
    ),
    (err: unknown) => err instanceof LicensePolicyError && /unknown license_class "publik"/.test(err.message),
  );

  assert.equal(objectStore.putCalls, 0);
  assert.equal(queries.length, 0);
});

test("content_hash is derived from bytes regardless of storage policy (same bytes ⇒ same hash)", async () => {
  // The dedupe contract on documents (unique on (content_hash, raw_blob_id))
  // depends on content_hash reflecting the actual content, not the
  // storage decision. This test pins that contract: identical bytes
  // produce identical content_hash whether the blob was stored or not.
  const objectStore = new RecordingObjectStore();
  const { db: db1 } = recordingDb();
  const { db: db2 } = recordingDb();

  const permissive = await ingestDocument(
    { db: db1, objectStore },
    {
      source: { source_id: SOURCE_ID, license_class: "public" },
      bytes: TWEET_BYTES,
      document: { kind: "social_post" },
    },
  );
  const ephemeral = await ingestDocument(
    { db: db2, objectStore },
    {
      source: { source_id: SOURCE_ID, license_class: "ephemeral" },
      bytes: TWEET_BYTES,
      document: { kind: "social_post" },
    },
  );

  assert.equal(permissive.document.content_hash, ephemeral.document.content_hash);
  assert.notEqual(
    permissive.document.raw_blob_id,
    ephemeral.document.raw_blob_id,
    "content_hash matches but raw_blob_id differs — that's the dedupe contract",
  );
});

test("ingestDocument propagates DocumentInput fields (title, author, kind, conversation_id) through to the insert", async () => {
  // Regression guard: future refactors of the orchestrator must not
  // silently drop optional document fields.
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  await ingestDocument(
    { db, objectStore },
    {
      source: { source_id: SOURCE_ID, license_class: "ephemeral" },
      bytes: TWEET_BYTES,
      document: {
        kind: "social_post",
        provider_doc_id: "reddit:t3_xyz",
        author: "u/example",
        conversation_id: "reddit:t3_xyz",
      },
    },
  );

  const values = queries[0]?.values ?? [];
  assert.equal(values[0], SOURCE_ID);
  assert.equal(values[1], "reddit:t3_xyz", "provider_doc_id must propagate");
  assert.equal(values[2], "social_post", "kind must propagate");
  assert.equal(values[4], "reddit:t3_xyz", "conversation_id must propagate");
  assert.equal(values[6], "u/example", "author must propagate");
});

test("rawBlobIdFromBytes-derived hash matches what ingestDocument emits in permissive mode", () => {
  // Sanity tie between the public hash helper and the orchestrator's
  // internal computation. If they ever diverge, downstream code that
  // computes hashes ahead of ingest (e.g., to query for existing docs)
  // would silently miss matches.
  assert.equal(rawBlobIdFromBytes(TWEET_BYTES), TWEET_HASH);
  assert.equal(TWEET_HASH.startsWith("sha256:"), true);
  assert.equal(ephemeralRawBlobIdForSource(SOURCE_ID).startsWith(EPHEMERAL_RAW_BLOB_ID_PREFIX), true);
});
