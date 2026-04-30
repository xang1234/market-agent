import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  createDocument,
  getConversation,
  getDocumentAncestors,
  getDocumentChildren,
  getDocumentThread,
} from "../src/document-repo.ts";
import { createSource } from "../src/source-repo.ts";
import type { QueryExecutor } from "../src/types.ts";
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

const PARENT_ID = "00000000-0000-4000-8000-0000000000a1";

const blobId = (label: string) => `sha256:${createHash("sha256").update(label).digest("hex")}`;

function emptyExecutor(): {
  db: QueryExecutor;
  queries: Array<{ text: string; values?: unknown[] }>;
} {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return { rows: [], command: "SELECT", rowCount: 0, oid: 0, fields: [] };
    },
  };
  return { db, queries };
}

test("getDocumentChildren queries direct children ordered by published_at", async () => {
  const { db, queries } = emptyExecutor();

  await getDocumentChildren(db, PARENT_ID);

  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /from documents/);
  assert.match(queries[0].text, /where parent_document_id = \$1/);
  assert.match(queries[0].text, /order by published_at nulls last, document_id/);
  assert.deepEqual(queries[0].values, [PARENT_ID]);
});

test("getDocumentChildren rejects malformed parent ids before querying", async () => {
  const { db, queries } = emptyExecutor();
  await assert.rejects(
    getDocumentChildren(db, "not-a-uuid"),
    /parent_document_id: must be a UUID v4/,
  );
  assert.equal(queries.length, 0);
});

test("getDocumentAncestors uses a recursive CTE walking up the parent chain", async () => {
  const { db, queries } = emptyExecutor();

  await getDocumentAncestors(db, PARENT_ID);

  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /with recursive chain as/);
  assert.match(queries[0].text, /join chain c on c\.parent_document_id = d\.document_id/);
  assert.match(queries[0].text, /order by depth desc/);
  assert.deepEqual(queries[0].values, [PARENT_ID]);
});

test("getDocumentThread uses a recursive CTE walking down from the root", async () => {
  const { db, queries } = emptyExecutor();

  await getDocumentThread(db, PARENT_ID);

  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /with recursive thread as/);
  assert.match(queries[0].text, /join thread t on d\.parent_document_id = t\.document_id/);
  assert.match(queries[0].text, /order by depth, published_at nulls last, document_id/);
  assert.deepEqual(queries[0].values, [PARENT_ID]);
});

test("getDocumentThread rejects malformed root ids before querying", async () => {
  const { db, queries } = emptyExecutor();
  await assert.rejects(
    getDocumentThread(db, "not-a-uuid"),
    /document_id: must be a UUID v4/,
  );
  assert.equal(queries.length, 0);
});

test("getConversation queries by conversation_id", async () => {
  const { db, queries } = emptyExecutor();

  await getConversation(db, "reddit:t3_xyz");

  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /where conversation_id = \$1/);
  assert.match(queries[0].text, /order by published_at nulls last, document_id/);
  assert.deepEqual(queries[0].values, ["reddit:t3_xyz"]);
});

test("getConversation rejects empty conversation ids before querying", async () => {
  const { db, queries } = emptyExecutor();
  await assert.rejects(
    getConversation(db, "   "),
    /conversation_id: must be a non-empty string/,
  );
  assert.equal(queries.length, 0);
});

test("threading round-trip: build a Reddit-like thread and traverse it", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for evidence repository integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-8la-threading");
  const client = await connectedClient(t, databaseUrl);

  const source = await createSource(client, {
    provider: "reddit",
    kind: "social_post",
    trust_tier: "tertiary",
    license_class: "public",
    retrieved_at: "2026-04-29T00:00:00Z",
  });

  const conversationId = "reddit:t3_thread_xyz";

  // Tree:
  //   root (OP)
  //     ├── reply_a (10:00)
  //     │     └── reply_a_nested (10:05)
  //     └── reply_b (10:02)
  const root = await createDocument(client, {
    source_id: source.source_id,
    kind: "social_post",
    conversation_id: conversationId,
    published_at: "2026-04-29T09:00:00Z",
    content_hash: blobId("op"),
    raw_blob_id: blobId("op"),
  });
  const replyA = await createDocument(client, {
    source_id: source.source_id,
    kind: "social_post",
    parent_document_id: root.document.document_id,
    conversation_id: conversationId,
    published_at: "2026-04-29T10:00:00Z",
    content_hash: blobId("reply-a"),
    raw_blob_id: blobId("reply-a"),
  });
  const replyANested = await createDocument(client, {
    source_id: source.source_id,
    kind: "social_post",
    parent_document_id: replyA.document.document_id,
    conversation_id: conversationId,
    published_at: "2026-04-29T10:05:00Z",
    content_hash: blobId("reply-a-nested"),
    raw_blob_id: blobId("reply-a-nested"),
  });
  const replyB = await createDocument(client, {
    source_id: source.source_id,
    kind: "social_post",
    parent_document_id: root.document.document_id,
    conversation_id: conversationId,
    published_at: "2026-04-29T10:02:00Z",
    content_hash: blobId("reply-b"),
    raw_blob_id: blobId("reply-b"),
  });

  // Direct children of root: replyA (10:00) before replyB (10:02)
  const children = await getDocumentChildren(client, root.document.document_id);
  assert.deepEqual(
    children.map((d) => d.document_id),
    [replyA.document.document_id, replyB.document.document_id],
  );

  // Ancestors of nested reply: root → replyA → replyANested (root first)
  const ancestors = await getDocumentAncestors(client, replyANested.document.document_id);
  assert.deepEqual(
    ancestors.map((d) => d.document_id),
    [
      root.document.document_id,
      replyA.document.document_id,
      replyANested.document.document_id,
    ],
  );

  // Full thread from root: 4 docs, depth-first ordering (root, depth1 in pub-time order, depth2)
  const thread = await getDocumentThread(client, root.document.document_id);
  assert.deepEqual(
    thread.map((d) => d.document_id),
    [
      root.document.document_id,
      replyA.document.document_id,
      replyB.document.document_id,
      replyANested.document.document_id,
    ],
  );

  // getConversation: all 4 docs by conversation_id, ordered by published_at
  const conversation = await getConversation(client, conversationId);
  assert.deepEqual(
    conversation.map((d) => d.document_id),
    [
      root.document.document_id,
      replyA.document.document_id,
      replyB.document.document_id,
      replyANested.document.document_id,
    ],
  );
});

test("getDocumentChildren returns empty for a leaf document", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for evidence repository integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-8la-threading-leaf");
  const client = await connectedClient(t, databaseUrl);

  const source = await createSource(client, {
    provider: "sec_edgar",
    kind: "filing",
    trust_tier: "primary",
    license_class: "public",
    retrieved_at: "2026-04-29T00:00:00Z",
  });
  const standalone = await createDocument(client, {
    source_id: source.source_id,
    kind: "filing",
    content_hash: blobId("standalone"),
    raw_blob_id: blobId("standalone"),
  });

  const children = await getDocumentChildren(client, standalone.document.document_id);
  assert.equal(children.length, 0);

  const ancestors = await getDocumentAncestors(client, standalone.document.document_id);
  assert.deepEqual(
    ancestors.map((d) => d.document_id),
    [standalone.document.document_id],
  );

  const thread = await getDocumentThread(client, standalone.document.document_id);
  assert.deepEqual(
    thread.map((d) => d.document_id),
    [standalone.document.document_id],
  );
});

test("createDocument rejects parent_document_id that does not exist (FK 23503)", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for evidence repository integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-8la-threading-orphan");
  const client = await connectedClient(t, databaseUrl);

  const source = await createSource(client, {
    provider: "reddit",
    kind: "social_post",
    trust_tier: "tertiary",
    license_class: "public",
    retrieved_at: "2026-04-29T00:00:00Z",
  });

  await assert.rejects(
    createDocument(client, {
      source_id: source.source_id,
      kind: "social_post",
      parent_document_id: "00000000-0000-4000-8000-00000000dead",
      content_hash: blobId("orphan-reply"),
      raw_blob_id: blobId("orphan-reply"),
    }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23503",
  );
});
