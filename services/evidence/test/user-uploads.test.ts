import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  USER_UPLOAD_LICENSE_CLASS,
  USER_UPLOAD_PROVIDER,
  getUserUploadDocument,
  ingestUserUpload,
  listUserUploadDocuments,
} from "../src/user-uploads.ts";
import type { QueryExecutor } from "../src/types.ts";
import { RecordingObjectStore } from "./recording-object-store.ts";

const USER_A = "11111111-1111-4111-a111-111111111111";
const USER_B = "22222222-2222-4222-a222-222222222222";
const SOURCE_ID = "33333333-3333-4333-a333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-a444-444444444444";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 fake pdf body");
const PDF_HASH = `sha256:${createHash("sha256").update(PDF_BYTES).digest("hex")}`;

function recordingDb() {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      const row = /insert into sources/.test(text)
        ? {
            source_id: SOURCE_ID,
            provider: values?.[0],
            kind: values?.[1],
            canonical_url: values?.[2],
            trust_tier: values?.[3],
            license_class: values?.[4],
            retrieved_at: new Date(values?.[5] as string),
            content_hash: values?.[6],
            user_id: values?.[7],
            created_at: new Date("2026-05-02T00:00:00.000Z"),
          }
        : {
            inserted: true,
            document_id: DOCUMENT_ID,
            source_id: values?.[0],
            provider_doc_id: values?.[1] ?? null,
            kind: values?.[2] ?? "upload",
            parent_document_id: null,
            conversation_id: null,
            title: values?.[5] ?? null,
            author: values?.[6] ?? null,
            published_at: null,
            lang: null,
            content_hash: values?.[9],
            raw_blob_id: values?.[10],
            parse_status: "pending",
            deleted_at: null,
            created_at: new Date("2026-05-02T00:00:00.000Z"),
            updated_at: new Date("2026-05-02T00:00:00.000Z"),
          };
      return {
        rows: [row] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

test("ingestUserUpload writes a user-scoped source (provider, kind, trust_tier, license_class, user_id) and a stored document", async () => {
  // Headline contract for the unit layer: a user upload yields a source
  // tagged with the uploader's user_id and the canonical user-upload
  // metadata (provider/kind/trust/license), plus a documents row whose
  // raw_blob_id is sha256-addressed (because user_private routes through
  // the permissive ingest path — visibility scoping comes from user_id,
  // not from withholding the blob).
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  const result = await ingestUserUpload(
    { db, objectStore },
    {
      userId: USER_A,
      bytes: PDF_BYTES,
      title: "Q1 research notes.pdf",
    },
  );

  assert.equal(result.source.user_id, USER_A);
  assert.equal(result.source.provider, USER_UPLOAD_PROVIDER);
  assert.equal(result.source.kind, "upload");
  assert.equal(result.source.trust_tier, "user");
  assert.equal(result.source.license_class, USER_UPLOAD_LICENSE_CLASS);
  assert.equal(result.ingest.status, "blob_stored");
  assert.equal(result.ingest.raw_blob_id, PDF_HASH);
  assert.equal(objectStore.putCalls, 1, "user_private must store the blob (visibility != retention)");
  assert.equal(await objectStore.has(PDF_HASH), true);

  // sources insert: user_id is the 8th positional parameter.
  assert.match(queries[0].text, /insert into sources/);
  assert.equal(queries[0].values?.[7], USER_A);
  // documents insert: title flows through as values[5] (per createDocument shape).
  assert.match(queries[1].text, /insert into documents/);
  assert.equal(queries[1].values?.[5], "Q1 research notes.pdf");
});

test("ingestUserUpload rejects an unset/malformed userId before touching db or object store", async () => {
  // Fail-closed: if the auth-extracting layer ever lets a bad user_id
  // through, this is the last gate before a source row gets written
  // without owner scoping.
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestUserUpload(
      { db, objectStore },
      { userId: "not-a-uuid", bytes: PDF_BYTES, title: "x.pdf" },
    ),
    /user_id: must be a UUID v4/,
  );
  await assert.rejects(
    ingestUserUpload(
      { db, objectStore },
      { userId: "", bytes: PDF_BYTES, title: "x.pdf" },
    ),
    /user_id: must be a UUID v4/,
  );

  assert.equal(queries.length, 0, "no row should be written on bad userId");
  assert.equal(objectStore.putCalls, 0);
});

test("ingestUserUpload rejects empty bytes (a zero-byte upload is meaningless)", async () => {
  const { db, queries } = recordingDb();
  const objectStore = new RecordingObjectStore();

  await assert.rejects(
    ingestUserUpload(
      { db, objectStore },
      { userId: USER_A, bytes: new Uint8Array(0), title: "empty.pdf" },
    ),
    /bytes: must be non-empty/,
  );

  assert.equal(queries.length, 0);
  assert.equal(objectStore.putCalls, 0);
});

test("listUserUploadDocuments scopes by user_id and kind='upload' at the SQL layer (not in JS)", async () => {
  // The bead's verification depends on this: filtering must happen in
  // the WHERE clause, not after-the-fact in JS, otherwise a malformed
  // call could leak rows.
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return { rows: [] as R[], command: "SELECT", rowCount: 0, oid: 0, fields: [] };
    },
  };

  await listUserUploadDocuments(db, USER_A);

  assert.equal(queries.length, 1);
  // user_id must appear as a parameterized predicate, NOT inlined.
  assert.match(queries[0].text, /where[\s\S]*sources\.user_id\s*=\s*\$1/i);
  // kind='upload' filter (constant, can be inline or parameterized).
  assert.match(queries[0].text, /sources\.kind\s*=\s*'upload'/i);
  assert.deepEqual(queries[0].values, [USER_A]);
});

test("listUserUploadDocuments rejects a malformed userId before querying (no DB error noise)", async () => {
  let calls = 0;
  const db: QueryExecutor = {
    async query() {
      calls += 1;
      throw new Error("query should not run");
    },
  };

  await assert.rejects(listUserUploadDocuments(db, "not-a-uuid"), /user_id: must be a UUID v4/);
  assert.equal(calls, 0);
});

test("getUserUploadDocument scopes by both document_id and user_id at the SQL layer", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return { rows: [] as R[], command: "SELECT", rowCount: 0, oid: 0, fields: [] };
    },
  };

  const result = await getUserUploadDocument(db, USER_B, DOCUMENT_ID);

  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /where[\s\S]*documents\.document_id\s*=\s*\$1/i);
  assert.match(queries[0].text, /sources\.user_id\s*=\s*\$2/i);
  assert.match(queries[0].text, /sources\.kind\s*=\s*'upload'/i);
  assert.deepEqual(queries[0].values, [DOCUMENT_ID, USER_B]);
  // No row returned ⇒ null. The contract is "return null on miss",
  // never throw — that would leak existence (an attacker could probe
  // valid document_ids by error-class differential).
  assert.equal(result, null);
});

test("getUserUploadDocument returns null on miss (existence-oracle defense, never throws on wrong user)", async () => {
  // Even if the document_id is real and belongs to a different user,
  // the WHERE clause ensures zero rows, and the helper returns null
  // — indistinguishable from a non-existent document_id.
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>() {
      return { rows: [] as R[], command: "SELECT", rowCount: 0, oid: 0, fields: [] };
    },
  };

  const result = await getUserUploadDocument(db, USER_A, DOCUMENT_ID);
  assert.equal(result, null);
});

test("getUserUploadDocument rejects malformed document_id and user_id before querying", async () => {
  let calls = 0;
  const db: QueryExecutor = {
    async query() {
      calls += 1;
      throw new Error("query should not run");
    },
  };

  await assert.rejects(
    getUserUploadDocument(db, USER_A, "not-a-uuid"),
    /document_id: must be a UUID v4/,
  );
  await assert.rejects(
    getUserUploadDocument(db, "not-a-uuid", DOCUMENT_ID),
    /user_id: must be a UUID v4/,
  );
  assert.equal(calls, 0);
});
