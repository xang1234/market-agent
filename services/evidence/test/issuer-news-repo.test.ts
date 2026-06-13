import test from "node:test";
import assert from "node:assert/strict";

import { clampNewsLimit, listIssuerNews, type IssuerNewsItem } from "../src/issuer-news-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

const ISSUER_ID = "33333333-3333-4333-a333-333333333333";

function row(overrides: Partial<IssuerNewsItem> = {}): IssuerNewsItem {
  return {
    document_id: "11111111-1111-4111-a111-111111111111",
    kind: "filing",
    title: "Q1 FY26 10-Q",
    published_at: "2026-05-03T00:00:00.000Z",
    provider: "sec_edgar",
    provider_doc_id: "0000320193-26-000050",
    ...overrides,
  };
}

function recordingDb(rows: IssuerNewsItem[]) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return { rows: rows as unknown as R[], command: "SELECT", rowCount: rows.length, oid: 0, fields: [] };
    },
  };
  return { db, queries };
}

test("listIssuerNews queries by issuer via EXISTS, newest first, and maps rows", async () => {
  const { db, queries } = recordingDb([row(), row({ document_id: "22222222-2222-4222-a222-222222222222", kind: "article", title: "Lumira lifts guidance", provider: "reuters" })]);

  const items = await listIssuerNews(db, { issuerId: ISSUER_ID, limit: 5 });

  // mapping
  assert.equal(items.length, 2);
  assert.equal(items[0].provider, "sec_edgar");
  assert.equal(items[1].kind, "article");

  // query shape: dedup via EXISTS on mentions, issuer-scoped, newest-first, limited
  const q = queries[0];
  assert.match(q.text, /from documents d/);
  assert.match(q.text, /exists\s*\(/i);
  assert.match(q.text, /m\.subject_kind = 'issuer'/);
  assert.match(q.text, /d\.deleted_at is null/);
  assert.match(q.text, /order by d\.published_at desc nulls last/);
  assert.deepEqual(q.values, [ISSUER_ID, 5]);
});

test("clampNewsLimit defaults to 8 and caps at 25", () => {
  assert.equal(clampNewsLimit(undefined), 8);
  assert.equal(clampNewsLimit(0), 8);
  assert.equal(clampNewsLimit(3), 3);
  assert.equal(clampNewsLimit(100), 25);
});

test("listIssuerNews rejects a non-uuid issuer id", async () => {
  const { db } = recordingDb([]);
  await assert.rejects(() => listIssuerNews(db, { issuerId: "not-a-uuid" }), /issuer_id/);
});
