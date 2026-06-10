import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import {
  selectReaderDocuments,
  READER_DOCUMENT_WINDOW_DAYS,
  type ReaderDocumentRow,
} from "../src/reader-documents.ts";

// ─── Fixed UUIDs ────────────────────────────────────────────────────────────
const SOURCE_A_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"; // filing / public
const SOURCE_B_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"; // article / ephemeral
const ISSUER_X_ID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const ISSUER_Y_ID = "dddddddd-dddd-4ddd-dddd-dddddddddddd";
const ISSUER_EMPTY_ID = "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee";

// ─── Seeding helper ──────────────────────────────────────────────────────────
// Returns the document_id of the inserted document (as text).
async function seedDocument(
  db: {
    query: (t: string, v?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  },
  opts: {
    sourceId: string;
    kind: "filing" | "transcript" | "article" | "research_note" | "social_post" | "thread" | "upload";
    publishedAt: string | null;
    rawBlobId: string;
    contentHash: string;
  },
): Promise<string> {
  const result = await db.query(
    `insert into documents (source_id, kind, published_at, raw_blob_id, content_hash)
     values ($1, $2, $3, $4, $5)
     returning document_id::text as document_id`,
    [opts.sourceId, opts.kind, opts.publishedAt, opts.rawBlobId, opts.contentHash],
  );
  return result.rows[0].document_id as string;
}

async function seedMention(
  db: {
    query: (t: string, v?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  },
  documentId: string,
  subjectId: string,
): Promise<void> {
  await db.query(
    `insert into mentions (document_id, subject_kind, subject_id, prominence, mention_count, confidence)
     values ($1, 'issuer', $2, 'body', 1, 0.9)`,
    [documentId, subjectId],
  );
}

// ─── Integration tests (require Docker + Postgres) ───────────────────────────

test("selectReaderDocuments — selects recent, non-ephemeral docs, kind-ranked", async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker not available");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "reader-docs-main");
  const db = await connectedClient(t, databaseUrl);

  // Seed sources
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash)
     values ($1, 'test', 'filing', 'primary', 'public', now(), 'h1')`,
    [SOURCE_A_ID],
  );
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash)
     values ($1, 'gdelt', 'article', 'tertiary', 'ephemeral', now(), 'h2')`,
    [SOURCE_B_ID],
  );

  // d1: filing, source A, published 10 days ago — should be selected
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const d1Id = await seedDocument(db, {
    sourceId: SOURCE_A_ID,
    kind: "filing",
    publishedAt: tenDaysAgo,
    rawBlobId: "sha256:" + "a".repeat(64),
    contentHash: "hash-d1",
  });

  // d2: article, source B (ephemeral) — must be excluded
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const d2Id = await seedDocument(db, {
    sourceId: SOURCE_B_ID,
    kind: "article",
    publishedAt: fiveDaysAgo,
    rawBlobId: "sha256:" + "b".repeat(64),
    contentHash: "hash-d2",
  });

  // d3: transcript, source A, published 400 days ago — outside window, must be excluded
  const fourHundredDaysAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
  const d3Id = await seedDocument(db, {
    sourceId: SOURCE_A_ID,
    kind: "transcript",
    publishedAt: fourHundredDaysAgo,
    rawBlobId: "sha256:" + "c".repeat(64),
    contentHash: "hash-d3",
  });

  // d4: different issuer Y — must not appear for issuer X
  const d4Id = await seedDocument(db, {
    sourceId: SOURCE_A_ID,
    kind: "filing",
    publishedAt: tenDaysAgo,
    rawBlobId: "sha256:" + "d".repeat(64),
    contentHash: "hash-d4",
  });

  // Seed mentions
  await seedMention(db, d1Id, ISSUER_X_ID);
  await seedMention(db, d2Id, ISSUER_X_ID);
  await seedMention(db, d3Id, ISSUER_X_ID);
  await seedMention(db, d4Id, ISSUER_Y_ID);

  const rows = await selectReaderDocuments(db, ISSUER_X_ID, 5);

  assert.deepEqual(
    rows.map((r) => r.document_id),
    [d1Id],
    "only d1 should be returned — d2 is ephemeral, d3 is outside window",
  );
  assert.equal(rows[0].source_id, SOURCE_A_ID);
  assert.equal(typeof rows[0].raw_blob_id, "string");
  assert.equal(rows[0].doc_kind, "filing");
});

test("selectReaderDocuments — returns empty array when issuer has no eligible documents", async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker not available");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "reader-docs-empty");
  const db = await connectedClient(t, databaseUrl);

  const rows = await selectReaderDocuments(db, ISSUER_EMPTY_ID, 5);
  assert.deepEqual(rows, []);
});

test("selectReaderDocuments — issuer Y docs do not appear for issuer X", async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker not available");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "reader-docs-isolation");
  const db = await connectedClient(t, databaseUrl);

  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash)
     values ($1, 'test', 'filing', 'primary', 'public', now(), 'hiso')`,
    [SOURCE_A_ID],
  );

  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const dYId = await seedDocument(db, {
    sourceId: SOURCE_A_ID,
    kind: "filing",
    publishedAt: tenDaysAgo,
    rawBlobId: "sha256:" + "f".repeat(64),
    contentHash: "hash-dy",
  });
  await seedMention(db, dYId, ISSUER_Y_ID);

  const rows = await selectReaderDocuments(db, ISSUER_X_ID, 5);
  assert.deepEqual(rows, []);
});

// ─── Pure unit tests (no database) ──────────────────────────────────────────
// Test kind-ranking and recency tiebreak using a fake QueryExecutor.

function makeRow(
  overrides: Partial<ReaderDocumentRow> & { document_id: string },
): ReaderDocumentRow {
  return {
    source_id: "src",
    raw_blob_id: "sha256:" + "0".repeat(64),
    doc_kind: "article",
    published_at: null,
    ...overrides,
  };
}

function fakeDb(fakeRows: ReaderDocumentRow[]) {
  return {
    query: async <R extends Record<string, unknown> = Record<string, unknown>>(
      _text: string,
      _values?: unknown[],
    ) => ({ rows: fakeRows as unknown as R[], rowCount: fakeRows.length, command: "SELECT", oid: 0, fields: [] }),
  };
}

test("selectReaderDocuments unit — kind ranking: filing < transcript < article", async () => {
  const rows = [
    makeRow({ document_id: "id-article", doc_kind: "article", published_at: "2025-01-03" }),
    makeRow({ document_id: "id-filing", doc_kind: "filing", published_at: "2025-01-01" }),
    makeRow({ document_id: "id-transcript", doc_kind: "transcript", published_at: "2025-01-02" }),
  ];

  const result = await selectReaderDocuments(fakeDb(rows), "any-issuer", 10);
  assert.deepEqual(
    result.map((r) => r.doc_kind),
    ["filing", "transcript", "article"],
    "filing should rank before transcript, transcript before article",
  );
});

test("selectReaderDocuments unit — recency tiebreak within same kind", async () => {
  const rows = [
    makeRow({ document_id: "id-old", doc_kind: "filing", published_at: "2024-06-01" }),
    makeRow({ document_id: "id-newer", doc_kind: "filing", published_at: "2025-01-15" }),
    makeRow({ document_id: "id-newest", doc_kind: "filing", published_at: "2025-06-01" }),
  ];

  const result = await selectReaderDocuments(fakeDb(rows), "any-issuer", 10);
  assert.deepEqual(
    result.map((r) => r.document_id),
    ["id-newest", "id-newer", "id-old"],
    "most recent first within the same kind",
  );
});

test("selectReaderDocuments unit — limit slices the ranked result", async () => {
  const rows = [
    makeRow({ document_id: "id-1", doc_kind: "filing", published_at: "2025-06-01" }),
    makeRow({ document_id: "id-2", doc_kind: "transcript", published_at: "2025-05-01" }),
    makeRow({ document_id: "id-3", doc_kind: "article", published_at: "2025-04-01" }),
    makeRow({ document_id: "id-4", doc_kind: "article", published_at: "2025-03-01" }),
  ];

  const result = await selectReaderDocuments(fakeDb(rows), "any-issuer", 2);
  assert.equal(result.length, 2, "limit should slice result to 2");
  assert.equal(result[0].doc_kind, "filing");
  assert.equal(result[1].doc_kind, "transcript");
});

test("selectReaderDocuments unit — unknown kind ranks below article", async () => {
  const rows = [
    makeRow({ document_id: "id-article", doc_kind: "article", published_at: "2025-01-01" }),
    makeRow({ document_id: "id-upload", doc_kind: "upload", published_at: "2025-01-01" }),
  ];

  const result = await selectReaderDocuments(fakeDb(rows), "any-issuer", 10);
  assert.equal(result[0].doc_kind, "article", "article (rank 3) should come before upload (rank 4)");
  assert.equal(result[1].doc_kind, "upload");
});

test("selectReaderDocuments unit — null published_at treated as empty string in recency sort", async () => {
  const rows = [
    makeRow({ document_id: "id-null-date", doc_kind: "filing", published_at: null }),
    makeRow({ document_id: "id-dated", doc_kind: "filing", published_at: "2025-01-01" }),
  ];

  const result = await selectReaderDocuments(fakeDb(rows), "any-issuer", 10);
  // "2025-01-01" > "" so dated should come first
  assert.equal(result[0].document_id, "id-dated", "dated filing should rank before null-dated filing");
});
