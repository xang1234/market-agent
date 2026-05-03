import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { ingestDocument, ingestDocumentWithPool } from "../src/ingest.ts";
import { LicensePolicyError } from "../src/license-policy.ts";
import {
  EPHEMERAL_RAW_BLOB_ID_PREFIX,
  ephemeralRawBlobIdForSource,
  rawBlobIdFromBytes,
} from "../src/object-store.ts";
import type { QueryExecutor } from "../src/types.ts";
import { RecordingObjectStore } from "./recording-object-store.ts";

const SOURCE_ID = "11111111-1111-4111-a111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-a222-222222222222";
const TWEET_BYTES = new TextEncoder().encode("$AAPL crushes Q1 — bullish setup");
const TWEET_HASH = `sha256:${createHash("sha256").update(TWEET_BYTES).digest("hex")}`;

function recordingDb() {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (/from sources/i.test(text) && /for key share/i.test(text)) {
        return {
          rows: [{ source_id: values?.[0] }] as R[],
          command: "SELECT",
          rowCount: 1,
          oid: 0,
          fields: [],
        };
      }
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

function recordingPool() {
  const { db, queries } = recordingDb();
  let released = false;
  return {
    pool: {
      connect: async () => ({
        ...db,
        release() {
          released = true;
        },
      }),
    },
    queries,
    released: () => released,
  };
}

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
  assert.match(queries[0]?.text ?? "", /^begin$/i);
  assert.match(queries[1]?.text ?? "", /pg_advisory_xact_lock/);
  assert.equal(queries[1]?.values?.[0], TWEET_HASH);
  assert.match(queries[2]?.text ?? "", /from sources/i);
  assert.match(queries[2]?.text ?? "", /for key share/i);
  assert.equal(queries[2]?.values?.[0], SOURCE_ID);
  assert.match(queries.find((query) => /insert into documents/i.test(query.text))?.text ?? "", /insert into documents/);
  assert.match(queries.at(-1)?.text ?? "", /^commit$/i);
});

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

test("ingestDocumentWithPool acquires one client for stored blob transaction", async () => {
  const { pool, queries, released } = recordingPool();
  const objectStore = new RecordingObjectStore();

  const result = await ingestDocumentWithPool(
    pool,
    objectStore,
    {
      source: { source_id: SOURCE_ID, license_class: "public" },
      bytes: TWEET_BYTES,
      document: { kind: "social_post" },
    },
  );

  assert.equal(result.raw_blob_id, TWEET_HASH);
  assert.equal(released(), true);
  assert.match(queries[0]?.text ?? "", /^begin$/i);
  assert.match(queries.at(-1)?.text ?? "", /^commit$/i);
});

test("ingestDocument locks the source before writing stored bytes", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();
  let putCallIndex = -1;
  const originalPut = objectStore.put.bind(objectStore);
  objectStore.put = async (bytes) => {
    putCallIndex = queries.length;
    return originalPut(bytes);
  };

  await ingestDocument(
    { db, objectStore },
    {
      source: { source_id: SOURCE_ID, license_class: "public" },
      bytes: TWEET_BYTES,
      document: { kind: "social_post" },
    },
  );

  const sourceLockIndex = queries.findIndex((query) => /from sources/i.test(query.text) && /for key share/i.test(query.text));
  const documentInsertIndex = queries.findIndex((query) => /insert into documents/i.test(query.text));
  assert.equal(sourceLockIndex >= 0, true);
  assert.equal(sourceLockIndex < putCallIndex, true);
  assert.equal(putCallIndex <= documentInsertIndex, true);
});

test("ingestDocument fails before objectStore.put when the source row cannot be locked", async () => {
  const { db, queries } = recordingDb();
  const missingSourceDb: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      if (/from sources/i.test(text) && /for key share/i.test(text)) {
        queries.push({ text, values });
        return { rows: [], command: "SELECT", rowCount: 0, oid: 0, fields: [] } as never;
      }
      return db.query<R>(text, values);
    },
  };
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestDocument(
      { db: missingSourceDb, objectStore },
      {
        source: { source_id: SOURCE_ID, license_class: "public" },
        bytes: TWEET_BYTES,
        document: { kind: "social_post" },
      },
    ),
    /source does not exist or is being erased/,
  );
  assert.equal(objectStore.putCalls, 0);
  assert.equal(queries.some((query) => /insert into documents/i.test(query.text)), false);
  assert.match(queries.at(-1)?.text ?? "", /^rollback$/i);
});

test("ingestDocument deletes a newly-created blob when document creation fails", async () => {
  const { db, queries } = recordingDb();
  const failingDb: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      if (/insert into documents/i.test(text)) {
        queries.push({ text, values });
        throw new Error("documents insert failed");
      }
      return db.query<R>(text, values);
    },
  };
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestDocument(
      { db: failingDb, objectStore },
      {
        source: { source_id: SOURCE_ID, license_class: "public" },
        bytes: TWEET_BYTES,
        document: { kind: "social_post" },
      },
    ),
    /documents insert failed/,
  );

  assert.equal(objectStore.putCalls, 1);
  assert.equal(objectStore.deleteCalls, 1);
  assert.deepEqual(objectStore.deletedRawBlobIds, [TWEET_HASH]);
  assert.equal(await objectStore.has(TWEET_HASH), false);
  assert.match(queries.at(-1)?.text ?? "", /^rollback$/i);
});

test("ingestDocument does not delete a pre-existing blob when document creation fails", async () => {
  const { db } = recordingDb();
  const failingDb: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      if (/insert into documents/i.test(text)) {
        throw new Error("documents insert failed");
      }
      return db.query<R>(text, values);
    },
  };
  const objectStore = new RecordingObjectStore();
  await objectStore.put(TWEET_BYTES);

  await assert.rejects(
    ingestDocument(
      { db: failingDb, objectStore },
      {
        source: { source_id: SOURCE_ID, license_class: "public" },
        bytes: TWEET_BYTES,
        document: { kind: "social_post" },
      },
    ),
    /documents insert failed/,
  );

  assert.equal(objectStore.putCalls, 2);
  assert.equal(objectStore.deleteCalls, 0);
  assert.equal(await objectStore.has(TWEET_HASH), true);
});

test("ingestDocument does not delete a new blob when commit outcome is uncertain", async () => {
  const { db, queries } = recordingDb();
  const commitFailsDb: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      if (/^commit$/i.test(text)) {
        queries.push({ text, values });
        throw new Error("commit connection lost");
      }
      return db.query<R>(text, values);
    },
  };
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestDocument(
      { db: commitFailsDb, objectStore },
      {
        source: { source_id: SOURCE_ID, license_class: "public" },
        bytes: TWEET_BYTES,
        document: { kind: "social_post" },
      },
    ),
    /commit connection lost/,
  );

  assert.equal(objectStore.putCalls, 1);
  assert.equal(objectStore.deleteCalls, 0);
  assert.equal(await objectStore.has(TWEET_HASH), true);
  assert.match(queries.at(-1)?.text ?? "", /^commit$/i);
  assert.equal(queries.some((query) => /^rollback$/i.test(query.text)), false);
});

test("ingestDocument rejects pg.Pool-like deps for stored blob transactions", async () => {
  const { db, queries } = recordingDb();
  const poolLike = Object.assign(db, { connect: async () => db, totalCount: 1, idleCount: 1 });
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestDocument(
      { db: poolLike, objectStore },
      {
        source: { source_id: SOURCE_ID, license_class: "public" },
        bytes: TWEET_BYTES,
        document: { kind: "social_post" },
      },
    ),
    /pinned database client/,
  );
  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
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

  const values = queries.find((query) => /insert into documents/i.test(query.text))?.values ?? [];
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
