import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { selectReaderDocuments } from "../src/reader-documents.ts";

// ─── Fixed UUIDs ────────────────────────────────────────────────────────────
const SOURCE_A_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"; // filing / public
const SOURCE_B_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"; // article / ephemeral
const ISSUER_X_ID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const ISSUER_Y_ID = "dddddddd-dddd-4ddd-dddd-dddddddddddd";
const ISSUER_EMPTY_ID = "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee";
const OUR_USER_ID = "ffffffff-ffff-4fff-afff-ffffffffffff";
const OTHER_USER_ID = "00000000-0000-4000-a000-000000000001";

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

  const rows = await selectReaderDocuments(db, ISSUER_X_ID, OUR_USER_ID, 5);

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

  const rows = await selectReaderDocuments(db, ISSUER_EMPTY_ID, OUR_USER_ID, 5);
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

  const rows = await selectReaderDocuments(db, ISSUER_X_ID, OUR_USER_ID, 5);
  assert.deepEqual(rows, []);
});

test("selectReaderDocuments — source owned by other user is excluded; source owned by our user is included", async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker not available");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "reader-docs-user-scope");
  const db = await connectedClient(t, databaseUrl);

  // Seed the two users
  await db.query(`insert into users (user_id, email) values ($1, $2)`, [OUR_USER_ID, "our@test.dev"]);
  await db.query(`insert into users (user_id, email) values ($1, $2)`, [OTHER_USER_ID, "other@test.dev"]);

  const SOURCE_OUR_ID = "11111111-1111-4111-a111-100000000001";
  const SOURCE_OTHER_ID = "11111111-1111-4111-a111-100000000002";

  // Source owned by OTHER_USER_ID
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash, user_id)
     values ($1, 'test', 'filing', 'primary', 'public', now(), 'hother', $2)`,
    [SOURCE_OTHER_ID, OTHER_USER_ID],
  );

  // Source owned by OUR_USER_ID
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash, user_id)
     values ($1, 'test', 'filing', 'primary', 'public', now(), 'hour', $2)`,
    [SOURCE_OUR_ID, OUR_USER_ID],
  );

  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  // Doc from OTHER's source — mentions issuer X
  const dOtherDocId = await seedDocument(db, {
    sourceId: SOURCE_OTHER_ID,
    kind: "filing",
    publishedAt: tenDaysAgo,
    rawBlobId: "sha256:" + "e".repeat(64),
    contentHash: "hash-dother",
  });
  await seedMention(db, dOtherDocId, ISSUER_X_ID);

  // Doc from OUR source — mentions issuer X
  const dOurDocId = await seedDocument(db, {
    sourceId: SOURCE_OUR_ID,
    kind: "filing",
    publishedAt: tenDaysAgo,
    rawBlobId: "sha256:" + "9".repeat(64),
    contentHash: "hash-dour",
  });
  await seedMention(db, dOurDocId, ISSUER_X_ID);

  const rows = await selectReaderDocuments(db, ISSUER_X_ID, OUR_USER_ID, 10);

  const ids = rows.map((r) => r.document_id);
  assert.ok(!ids.includes(dOtherDocId), "doc from other user's source must not appear");
  assert.ok(ids.includes(dOurDocId), "doc from our user's source must appear");
});

test("selectReaderDocuments — SQL ranking: kind preference, recency tiebreak, limit", async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker not available");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "reader-docs-ranking");
  const db = await connectedClient(t, databaseUrl);

  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash)
     values ($1, 'test', 'filing', 'primary', 'public', now(), 'hrank')`,
    [SOURCE_A_ID],
  );

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  // Inserted deliberately out of rank order; expected order is
  // filing (newest first within kind) > transcript > article > upload.
  const seeds: Array<{ kind: Parameters<typeof seedDocument>[1]["kind"]; publishedAt: string | null; blob: string }> = [
    { kind: "article", publishedAt: daysAgo(2), blob: "1" },
    { kind: "filing", publishedAt: daysAgo(30), blob: "2" },
    { kind: "upload", publishedAt: daysAgo(1), blob: "3" },
    { kind: "filing", publishedAt: daysAgo(5), blob: "4" },
    { kind: "transcript", publishedAt: daysAgo(3), blob: "5" },
    { kind: "filing", publishedAt: null, blob: "6" }, // created_at (now) is the recency fallback
  ];
  const idByBlob = new Map<string, string>();
  for (const s of seeds) {
    const id = await seedDocument(db, {
      sourceId: SOURCE_A_ID,
      kind: s.kind,
      publishedAt: s.publishedAt,
      rawBlobId: "sha256:" + s.blob.repeat(64),
      contentHash: `hash-rank-${s.blob}`,
    });
    idByBlob.set(s.blob, id);
    await seedMention(db, id, ISSUER_X_ID);
  }

  const all = await selectReaderDocuments(db, ISSUER_X_ID, OUR_USER_ID, 10);
  assert.deepEqual(
    all.map((r) => r.document_id),
    [
      idByBlob.get("6"), // filing, published_at null → created_at=now is most recent
      idByBlob.get("4"), // filing, 5 days ago
      idByBlob.get("2"), // filing, 30 days ago
      idByBlob.get("5"), // transcript
      idByBlob.get("1"), // article
      idByBlob.get("3"), // upload (unranked kind) last despite being most recent
    ],
    "kind preference first, then coalesce(published_at, created_at) desc within kind",
  );

  const limited = await selectReaderDocuments(db, ISSUER_X_ID, OUR_USER_ID, 2);
  assert.deepEqual(
    limited.map((r) => r.document_id),
    [idByBlob.get("6"), idByBlob.get("4")],
    "limit truncates the ranked result, keeping the best-ranked rows",
  );
});
