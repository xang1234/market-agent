import test from "node:test";
import assert from "node:assert/strict";

import {
  getUserUploadDocument,
  ingestUserUpload,
  listUserUploadDocuments,
} from "../src/user-uploads.ts";
import { MemoryObjectStore } from "../src/object-store.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";
import type { QueryExecutor } from "../src/types.ts";

async function createTestUser(client: QueryExecutor, email: string): Promise<string> {
  const { rows } = await client.query<{ user_id: string }>(
    `insert into users (email) values ($1) returning user_id::text as user_id`,
    [email],
  );
  return rows[0].user_id;
}

// The bead's verification: "Upload PDF; visible only to uploader." This
// test pins exactly that contract end-to-end against a real Postgres
// running the 0011_sources_user_id migration.
test(
  "fra-1ji headline: user A's upload is visible to A and invisible to B (list + get)",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "fra-1ji-uploads");
    const client = await connectedClient(t, databaseUrl);
    const objectStore = new MemoryObjectStore();

    const userA = await createTestUser(client, "alice@example.com");
    const userB = await createTestUser(client, "bob@example.com");

    const uploadA = await ingestUserUpload(
      { db: client, objectStore },
      {
        userId: userA,
        bytes: new TextEncoder().encode("%PDF-1.4 alice's research notes"),
        title: "alice-q1-notes.pdf",
      },
    );

    assert.equal(uploadA.source.user_id, userA, "source row carries the uploader's user_id");
    assert.equal(uploadA.source.kind, "upload");
    assert.equal(uploadA.source.license_class, "user_private");
    assert.equal(uploadA.source.trust_tier, "user");
    assert.match(uploadA.ingest.raw_blob_id, /^sha256:[0-9a-f]{64}$/);
    assert.equal(
      await objectStore.has(uploadA.ingest.raw_blob_id),
      true,
      "user_private uploads MUST be stored — visibility is enforced via user_id, not retention",
    );

    // User A sees their own document
    const aList = await listUserUploadDocuments(client, userA);
    assert.equal(aList.length, 1);
    assert.equal(aList[0].document_id, uploadA.ingest.document.document_id);
    assert.equal(aList[0].title, "alice-q1-notes.pdf");

    // User B sees nothing — not even with the right document_id
    const bList = await listUserUploadDocuments(client, userB);
    assert.equal(bList.length, 0, "user B must not see user A's upload in their list");

    const bGet = await getUserUploadDocument(client, userB, uploadA.ingest.document.document_id);
    assert.equal(
      bGet,
      null,
      "user B must not be able to fetch user A's document by id (existence-oracle defense)",
    );

    // User A can fetch the document by id
    const aGet = await getUserUploadDocument(client, userA, uploadA.ingest.document.document_id);
    assert.ok(aGet, "user A must be able to fetch their own document");
    assert.equal(aGet.document_id, uploadA.ingest.document.document_id);
    assert.equal(aGet.title, "alice-q1-notes.pdf");
  },
);

test(
  "fra-1ji: getUserUploadDocument refuses to return non-upload sources even when owned by the user",
  { skip: !dockerAvailable() },
  async (t) => {
    // Defensive: a user might own a non-upload source via some future
    // workflow (e.g., a bookmarked article they tagged). The upload-
    // scoped helper must NOT return it — that's what the kind='upload'
    // predicate in the WHERE clause enforces.
    const { databaseUrl } = await bootstrapDatabase(t, "fra-1ji-non-upload");
    const client = await connectedClient(t, databaseUrl);

    const userA = await createTestUser(client, "alice@example.com");

    // Create a user-owned source with kind != 'upload' — done via raw SQL
    // because createSource's SourceKind union allows other kinds, but
    // the query helper specifically scopes to uploads.
    const { rows: sourceRows } = await client.query<{ source_id: string }>(
      `insert into sources (provider, kind, trust_tier, license_class, retrieved_at, user_id)
       values ('user_bookmark', 'article', 'user', 'user_private', now(), $1)
       returning source_id::text as source_id`,
      [userA],
    );
    const sourceId = sourceRows[0].source_id;

    const { rows: docRows } = await client.query<{ document_id: string }>(
      `insert into documents (source_id, kind, content_hash, raw_blob_id)
       values ($1, 'article', 'sha256:fake', 'sha256:00000000000000000000000000000000000000000000000000000000fakefake')
       returning document_id::text as document_id`,
      [sourceId],
    );

    const found = await getUserUploadDocument(client, userA, docRows[0].document_id);
    assert.equal(
      found,
      null,
      "the upload-scoped getter must not surface a kind='article' document even if the user owns the source",
    );

    const list = await listUserUploadDocuments(client, userA);
    assert.equal(list.length, 0, "the upload-scoped lister must not surface non-upload kinds");
  },
);

test(
  "fra-1ji: deleting a user cascades to their sources (and documents) — orphaned-data defense",
  { skip: !dockerAvailable() },
  async (t) => {
    // The 0011 migration sets ON DELETE CASCADE on sources.user_id ->
    // users.user_id. This test pins that contract: when a user is
    // deleted, their uploads disappear too. Without this, deleting a
    // user leaves orphaned source/document rows that the application
    // would never garbage-collect.
    const { databaseUrl } = await bootstrapDatabase(t, "fra-1ji-cascade");
    const client = await connectedClient(t, databaseUrl);
    const objectStore = new MemoryObjectStore();

    const userA = await createTestUser(client, "alice@example.com");

    await ingestUserUpload(
      { db: client, objectStore },
      {
        userId: userA,
        bytes: new TextEncoder().encode("%PDF-1.4 doomed"),
        title: "doomed.pdf",
      },
    );

    const before = await listUserUploadDocuments(client, userA);
    assert.equal(before.length, 1);

    await client.query(`delete from users where user_id = $1`, [userA]);

    const after = await listUserUploadDocuments(client, userA);
    assert.equal(after.length, 0, "user delete must cascade to their sources and documents");

    const { rows: srcCount } = await client.query<{ count: string }>(
      `select count(*)::text as count from sources where user_id = $1`,
      [userA],
    );
    assert.equal(srcCount[0].count, "0");
  },
);
