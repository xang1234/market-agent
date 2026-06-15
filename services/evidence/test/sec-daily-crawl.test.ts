import { test } from "node:test";
import assert from "node:assert/strict";
import { crawlDailyFilings, type FormHandler } from "../src/sec-daily-crawl.ts";
import type { FilingIndexEntry } from "../src/sec-daily-index.ts";
import type { QueryExecutor } from "../src/types.ts";

const ENTRIES: FilingIndexEntry[] = [
  { cik: 320193, company: "Apple", form: "4", filedDate: "2026-06-12", fileName: "edgar/data/320193/0000320193-26-000050.txt", accession: "0000320193-26-000050" },
  { cik: 789019, company: "MSFT", form: "8-K", filedDate: "2026-06-12", fileName: "edgar/data/789019/0000789019-26-000015.txt", accession: "0000789019-26-000015" },
  { cik: 1, company: "Ignore", form: "10-Q", filedDate: "2026-06-12", fileName: "edgar/data/1/0000000001-26-000001.txt", accession: "0000000001-26-000001" },
];

function deps(opts: { existingAccessions?: Set<string> } = {}) {
  const existing = opts.existingAccessions ?? new Set<string>();
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/from documents/i.test(sql)) {
        const accession = params[0] as string;
        return { rows: existing.has(accession) ? [{ document_id: "doc-1" }] : [] } as never;
      }
      return { rows: [] } as never;
    },
  } as unknown as QueryExecutor;
  const client = { fetchDailyIndex: async (_d: Date) => ENTRIES } as never;
  return { db, client };
}

test("dispatches only the requested forms to their handler; ignores others", async () => {
  const seen: string[] = [];
  const handler: FormHandler = async (entry) => { seen.push(`${entry.form}:${entry.accession}`); return { ingested: true }; };
  const d = deps();
  const result = await crawlDailyFilings(
    { db: d.db, client: d.client, objectStore: {} as never },
    { date: new Date("2026-06-12T00:00:00Z"), handlers: { "4": handler, "8-K": handler } },
  );
  assert.deepEqual(seen.sort(), ["4:0000320193-26-000050", "8-K:0000789019-26-000015"]);
  assert.equal(result.byForm["4"].ingested, 1);
  assert.equal(result.byForm["8-K"].ingested, 1);
});

test("skips filings whose accession already has a documents row (idempotent)", async () => {
  const handlerCalls: string[] = [];
  const handler: FormHandler = async (entry) => { handlerCalls.push(entry.accession); return { ingested: true }; };
  const d = deps({ existingAccessions: new Set(["0000320193-26-000050"]) });
  const result = await crawlDailyFilings(
    { db: d.db, client: d.client, objectStore: {} as never },
    { date: new Date("2026-06-12T00:00:00Z"), handlers: { "4": handler } },
  );
  assert.deepEqual(handlerCalls, []);
  assert.equal(result.byForm["4"].skipped, 1);
  assert.equal(result.byForm["4"].ingested, 0);
});

test("a handler throwing marks that form partial but does not abort the crawl", async () => {
  const ok: FormHandler = async () => ({ ingested: true });
  const boom: FormHandler = async () => { throw new Error("parse failed"); };
  const d = deps();
  const result = await crawlDailyFilings(
    { db: d.db, client: d.client, objectStore: {} as never },
    { date: new Date("2026-06-12T00:00:00Z"), handlers: { "4": boom, "8-K": ok } },
  );
  assert.equal(result.byForm["4"].status, "partial");
  assert.equal(result.byForm["8-K"].status, "succeeded");
});
