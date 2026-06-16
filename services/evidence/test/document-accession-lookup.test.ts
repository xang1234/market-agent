import { test } from "node:test";
import assert from "node:assert/strict";
import { findLiveDocumentIdByAccession } from "../src/document-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

function fakeDb(rows: unknown[]): { db: QueryExecutor; calls: Array<{ text: string; values: unknown[] }> } {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return { rows } as never;
    },
  } as unknown as QueryExecutor;
  return { db, calls };
}

test("findLiveDocumentIdByAccession returns the live document id when present", async () => {
  const { db } = fakeDb([{ document_id: "doc-9" }]);
  assert.equal(await findLiveDocumentIdByAccession(db, "0000320193-26-000050"), "doc-9");
});

test("findLiveDocumentIdByAccession returns null when no live document matches", async () => {
  const { db } = fakeDb([]);
  assert.equal(await findLiveDocumentIdByAccession(db, "0000000000-00-000000"), null);
});

test("findLiveDocumentIdByAccession looks up by provider_doc_id excluding soft-deleted rows", async () => {
  const { db, calls } = fakeDb([]);
  await findLiveDocumentIdByAccession(db, "0000320193-26-000050");
  assert.match(calls[0].text, /from documents/i);
  assert.match(calls[0].text, /provider_doc_id = \$1/i);
  assert.match(calls[0].text, /deleted_at is null/i);
  assert.deepEqual(calls[0].values, ["0000320193-26-000050"]);
});
