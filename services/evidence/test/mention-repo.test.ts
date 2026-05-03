import test from "node:test";
import assert from "node:assert/strict";

import {
  MENTION_PROMINENCES,
  createMention,
  listMentionsForDocument,
} from "../src/mention-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const DOCUMENT_ID = "11111111-1111-4111-a111-111111111111";
const MENTION_ID = "22222222-2222-4222-a222-222222222222";
const SUBJECT_ID = "33333333-3333-4333-a333-333333333333";

function mentionRow(overrides: Record<string, unknown> = {}) {
  return {
    mention_id: MENTION_ID,
    document_id: DOCUMENT_ID,
    subject_kind: "issuer",
    subject_id: SUBJECT_ID,
    prominence: "headline",
    mention_count: 2,
    confidence: "0.87",
    created_at: new Date("2026-05-03T00:00:00.000Z"),
    ...overrides,
  };
}

function recordingDb(rows = [mentionRow()]) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return {
        rows: rows as R[],
        command: text.includes("insert") ? "INSERT" : "SELECT",
        rowCount: rows.length,
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

test("createMention inserts a validated mention row and normalizes numeric fields", async () => {
  const { db, queries } = recordingDb();

  const mention = await createMention(db, {
    document_id: DOCUMENT_ID,
    subject_kind: "issuer",
    subject_id: SUBJECT_ID,
    prominence: "headline",
    mention_count: 2,
    confidence: 0.87,
  });

  assert.equal(mention.mention_id, MENTION_ID);
  assert.equal(mention.subject_ref.kind, "issuer");
  assert.equal(mention.subject_ref.id, SUBJECT_ID);
  assert.equal(mention.mention_count, 2);
  assert.equal(mention.confidence, 0.87);
  assert.equal(queries.length, 1);
  assert.match(queries[0]!.text, /insert into mentions/);
  assert.match(queries[0]!.text, /on conflict \(document_id, subject_kind, subject_id, prominence\)/);
  assert.deepEqual(queries[0]!.values, [
    DOCUMENT_ID,
    "issuer",
    SUBJECT_ID,
    "headline",
    2,
    0.87,
  ]);
});

test("listMentionsForDocument queries by document and returns mentions in stable prominence order", async () => {
  const { db, queries } = recordingDb([
    mentionRow({ mention_id: "22222222-2222-4222-a222-333333333333", prominence: "body" }),
    mentionRow({ mention_id: MENTION_ID, prominence: "headline" }),
  ]);

  const mentions = await listMentionsForDocument(db, DOCUMENT_ID);

  assert.equal(mentions.length, 2);
  assert.equal(queries.length, 1);
  assert.match(queries[0]!.text, /where document_id = \$1/);
  assert.match(queries[0]!.text, /case prominence/);
  assert.deepEqual(queries[0]!.values, [DOCUMENT_ID]);
});

test("createMention rejects invalid mention inputs before querying", async () => {
  const { db, queries } = recordingDb();

  await assert.rejects(
    () =>
      createMention(db, {
        document_id: "not-a-uuid",
        subject_kind: "issuer",
        subject_id: SUBJECT_ID,
        prominence: "headline",
        mention_count: 1,
        confidence: 0.5,
      }),
    /document_id/,
  );
  await assert.rejects(
    () =>
      createMention(db, {
        document_id: DOCUMENT_ID,
        subject_kind: "issuer",
        subject_id: SUBJECT_ID,
        prominence: "footer" as never,
        mention_count: 1,
        confidence: 0.5,
      }),
    /prominence/,
  );
  await assert.rejects(
    () =>
      createMention(db, {
        document_id: DOCUMENT_ID,
        subject_kind: "issuer",
        subject_id: SUBJECT_ID,
        prominence: "headline",
        mention_count: 0,
        confidence: 0.5,
      }),
    /mention_count/,
  );
  await assert.rejects(
    () =>
      createMention(db, {
        document_id: DOCUMENT_ID,
        subject_kind: "issuer",
        subject_id: SUBJECT_ID,
        prominence: "headline",
        mention_count: 1,
        confidence: 1.1,
      }),
    /confidence/,
  );

  assert.equal(queries.length, 0);
});

test("MENTION_PROMINENCES pins the schema enum and is frozen", () => {
  assert.deepEqual([...MENTION_PROMINENCES], ["headline", "lead", "body", "incidental"]);
  assert.equal(Object.isFrozen(MENTION_PROMINENCES), true);
});
