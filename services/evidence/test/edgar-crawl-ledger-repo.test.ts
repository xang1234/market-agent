import { test } from "node:test";
import assert from "node:assert/strict";
import { recordCrawlBatch } from "../src/edgar-crawl-ledger-repo.ts";
import type { QueryExecutor } from "../src/types.ts";

function fakeDb(rows: unknown[]): { db: QueryExecutor; calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows } as never;
    },
  } as unknown as QueryExecutor;
  return { db, calls };
}

test("recordCrawlBatch upserts on (form, index_date) with counts", async () => {
  const { db, calls } = fakeDb([]);
  await recordCrawlBatch(db, {
    form: "4",
    indexDate: "2026-06-12",
    status: "succeeded",
    filingsTotal: 10,
    filingsIngested: 8,
    filingsSkipped: 2,
    startedAt: "2026-06-12T06:00:00Z",
  });
  assert.match(calls[0].sql, /insert into edgar_crawl_ledger/i);
  assert.match(calls[0].sql, /on conflict \(form, index_date\) do update/i);
  assert.deepEqual(calls[0].params.slice(0, 3), ["4", "2026-06-12", "succeeded"]);
});
