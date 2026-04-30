import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  createDocument,
  getDocument,
} from "../src/document-repo.ts";
import { createSource } from "../src/source-repo.ts";
import type { QueryExecutor } from "../src/types.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

const SOURCE_ID = "00000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000101";

const blobId = (label: string) => `sha256:${createHash("sha256").update(label).digest("hex")}`;
const DOC_BLOB_ID = blobId("document-content");
const DUPLICATE_BLOB_ID = blobId("duplicate");
const EXISTING_BLOB_ID = blobId("existing");
const PRESS_RELEASE_BLOB_ID = blobId("same-press-release");

test("createDocument inserts metadata and returns created status", async () => {
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
            provider_doc_id: "0000320193-25-000079",
            kind: "filing",
            parent_document_id: null,
            conversation_id: null,
            title: "Apple 10-Q",
            author: null,
            published_at: new Date("2026-04-28T21:00:00.000Z"),
            lang: "en",
            content_hash: DOC_BLOB_ID,
            raw_blob_id: DOC_BLOB_ID,
            parse_status: "pending",
            deleted_at: null,
            created_at: new Date("2026-04-29T00:00:00.000Z"),
            updated_at: new Date("2026-04-29T00:00:00.000Z"),
          },
        ] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };

  const result = await createDocument(db, {
    source_id: SOURCE_ID,
    provider_doc_id: "0000320193-25-000079",
    kind: "filing",
    title: "Apple 10-Q",
    published_at: "2026-04-28T21:00:00Z",
    lang: "en",
    content_hash: DOC_BLOB_ID,
    raw_blob_id: DOC_BLOB_ID,
  });

  assert.match(queries[0].text, /insert into documents/);
  assert.match(
    queries[0].text,
    /on conflict \(content_hash, raw_blob_id\) do update/,
  );
  assert.match(queries[0].text, /returning \(xmax = 0\) as inserted/);
  assert.deepEqual(queries[0].values, [
    SOURCE_ID,
    "0000320193-25-000079",
    "filing",
    null,
    null,
    "Apple 10-Q",
    null,
    "2026-04-28T21:00:00Z",
    "en",
    DOC_BLOB_ID,
    DOC_BLOB_ID,
    "pending",
  ]);
  assert.equal(result.status, "created");
  assert.equal(result.document.document_id, DOCUMENT_ID);
  assert.equal(result.document.published_at, "2026-04-28T21:00:00.000Z");
});

test("createDocument returns existing row when content hash and raw blob id already exist", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: [
          {
            inserted: false,
            document_id: DOCUMENT_ID,
            source_id: SOURCE_ID,
            provider_doc_id: "provider-doc-1",
            kind: "filing",
            parent_document_id: null,
            conversation_id: null,
            title: "Existing Filing",
            author: null,
            published_at: null,
            lang: "en",
            content_hash: DUPLICATE_BLOB_ID,
            raw_blob_id: DUPLICATE_BLOB_ID,
            parse_status: "parsed",
            deleted_at: null,
            created_at: new Date("2026-04-29T00:00:00.000Z"),
            updated_at: new Date("2026-04-29T00:00:00.000Z"),
          },
        ] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };

  const result = await createDocument(db, {
    source_id: "00000000-0000-4000-8000-000000000002",
    provider_doc_id: "provider-doc-2",
    kind: "filing",
    content_hash: DUPLICATE_BLOB_ID,
    raw_blob_id: DUPLICATE_BLOB_ID,
  });

  assert.equal(result.status, "already_present");
  assert.equal(result.document.document_id, DOCUMENT_ID);
  assert.equal(result.document.source_id, SOURCE_ID);
  assert.equal(queries.length, 1);
  assert.match(
    queries[0].text,
    /on conflict \(content_hash, raw_blob_id\) do update/,
  );
});

test("getDocument returns a document row by id", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: [
          {
            document_id: DOCUMENT_ID,
            source_id: SOURCE_ID,
            provider_doc_id: "provider-doc-1",
            kind: "article",
            parent_document_id: null,
            conversation_id: null,
            title: "Existing Article",
            author: "Newswire",
            published_at: new Date("2026-04-29T01:00:00.000Z"),
            lang: "en",
            content_hash: EXISTING_BLOB_ID,
            raw_blob_id: EXISTING_BLOB_ID,
            parse_status: "parsed",
            deleted_at: null,
            created_at: new Date("2026-04-29T00:00:00.000Z"),
            updated_at: new Date("2026-04-29T00:00:00.000Z"),
          },
        ] as R[],
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };

  const document = await getDocument(db, DOCUMENT_ID);

  assert.equal(document?.document_id, DOCUMENT_ID);
  assert.equal(document?.kind, "article");
  assert.equal(document?.published_at, "2026-04-29T01:00:00.000Z");
  assert.match(queries[0].text, /from documents/);
  assert.deepEqual(queries[0].values, [DOCUMENT_ID]);
});

test("getDocument rejects malformed ids before querying", async () => {
  let queryCalls = 0;
  const db: QueryExecutor = {
    async query() {
      queryCalls += 1;
      throw new Error("query should not run");
    },
  };

  await assert.rejects(
    getDocument(db, "not-a-document-id"),
    /document_id: must be a UUID v4/,
  );
  assert.equal(queryCalls, 0);
});

test("createDocument rejects malformed document metadata before querying", async () => {
  let queryCalls = 0;
  const db: QueryExecutor = {
    async query() {
      queryCalls += 1;
      throw new Error("query should not run");
    },
  };

  await assert.rejects(
    createDocument(db, {
      source_id: "not-a-uuid",
      kind: "filing",
      content_hash: DOC_BLOB_ID,
      raw_blob_id: DOC_BLOB_ID,
    }),
    /source_id: must be a UUID v4/,
  );

  await assert.rejects(
    createDocument(db, {
      source_id: SOURCE_ID,
      kind: "not-a-kind" as never,
      content_hash: DOC_BLOB_ID,
      raw_blob_id: DOC_BLOB_ID,
    }),
    /kind: must be one of/,
  );

  await assert.rejects(
    createDocument(db, {
      source_id: SOURCE_ID,
      kind: "filing",
      content_hash: "   ",
      raw_blob_id: DOC_BLOB_ID,
    }),
    /content_hash: must be a non-empty string/,
  );

  await assert.rejects(
    createDocument(db, {
      source_id: SOURCE_ID,
      kind: "filing",
      published_at: "2026-02-31T00:00:00Z",
      content_hash: DOC_BLOB_ID,
      raw_blob_id: DOC_BLOB_ID,
    }),
    /published_at: must be an ISO-8601 timestamp with explicit Z or offset/,
  );

  await assert.rejects(
    createDocument(db, {
      source_id: SOURCE_ID,
      kind: "filing",
      content_hash: DOC_BLOB_ID,
      raw_blob_id: "blob:not-a-content-addressed-id",
    }),
    /raw_blob_id: must match sha256:/,
  );

  assert.equal(queryCalls, 0);
});

test("double ingest of the same content returns the existing document row", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for evidence repository integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-131-document-repo");
  const client = await connectedClient(t, databaseUrl);
  const firstSource = await createSource(client, {
    provider: "sec_edgar",
    kind: "filing",
    trust_tier: "primary",
    license_class: "public",
    retrieved_at: "2026-04-29T00:00:00Z",
  });
  const secondSource = await createSource(client, {
    provider: "newswire",
    kind: "press_release",
    trust_tier: "secondary",
    license_class: "licensed",
    retrieved_at: "2026-04-29T00:01:00Z",
  });

  const first = await createDocument(client, {
    source_id: firstSource.source_id,
    provider_doc_id: "provider-a-doc",
    kind: "filing",
    content_hash: PRESS_RELEASE_BLOB_ID,
    raw_blob_id: PRESS_RELEASE_BLOB_ID,
  });
  const second = await createDocument(client, {
    source_id: secondSource.source_id,
    provider_doc_id: "provider-b-doc",
    kind: "article",
    content_hash: PRESS_RELEASE_BLOB_ID,
    raw_blob_id: PRESS_RELEASE_BLOB_ID,
  });

  assert.equal(first.status, "created");
  assert.equal(second.status, "already_present");
  assert.equal(second.document.document_id, first.document.document_id);
  assert.equal(second.document.source_id, firstSource.source_id);
});
