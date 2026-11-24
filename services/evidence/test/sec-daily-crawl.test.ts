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

const STORED = (accession: string) => ({ status: "stored", rows: [accession] }) as const;

function deps(opts: { existingAccessions?: Set<string>; entries?: FilingIndexEntry[] } = {}) {
  const existing = opts.existingAccessions ?? new Set<string>();
  const ledger: unknown[][] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/insert into edgar_crawl_ledger/i.test(sql)) ledger.push(params);
      if (/from documents/i.test(sql)) {
        const accession = params[0] as string;
        return { rows: existing.has(accession) ? [{ document_id: "doc-1" }] : [] } as never;
      }
      return { rows: [] } as never;
    },
  } as unknown as QueryExecutor;
  const client = { fetchDailyIndex: async (_d: Date) => opts.entries ?? ENTRIES } as never;
  return { db, client, ledger };
}

// The ledger row a form's crawl wrote: [form, date, status, total, ingested, skipped, started, failures].
const ledgerRow = (ledger: unknown[][], form: string) => ledger.find((params) => params[0] === form);

test("dispatches only the requested forms to their handler; ignores others", async () => {
  const seen: string[] = [];
  const handler: FormHandler = async (entry) => { seen.push(`${entry.form}:${entry.accession}`); return STORED(entry.accession); };
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
  const handler: FormHandler = async (entry) => { handlerCalls.push(entry.accession); return STORED(entry.accession); };
  const d = deps({ existingAccessions: new Set(["0000320193-26-000050"]) });
  const result = await crawlDailyFilings(
    { db: d.db, client: d.client, objectStore: {} as never },
    { date: new Date("2026-06-12T00:00:00Z"), handlers: { "4": handler } },
  );
  assert.deepEqual(handlerCalls, []);
  assert.equal(result.byForm["4"].skipped, 1);
  assert.equal(result.byForm["4"].ingested, 0);
  assert.deepEqual(result.byForm["4"].skipReasons, { already_stored: 1 });
});

test("a filing the handler did not ingest is counted under the handler's reason", async () => {
  const untracked: FormHandler = async () => ({ status: "empty", reason: "issuer_not_tracked" });
  const d = deps();
  const result = await crawlDailyFilings(
    { db: d.db, client: d.client, objectStore: {} as never },
    { date: new Date("2026-06-12T00:00:00Z"), handlers: { "4": untracked } },
  );
  assert.deepEqual(result.byForm["4"], { total: 1, ingested: 0, skipped: 1, status: "succeeded", skipReasons: { issuer_not_tracked: 1 }, failures: [] });
  assert.equal(ledgerRow(d.ledger, "4")?.[2], "succeeded");
  assert.equal(ledgerRow(d.ledger, "4")?.[7], "[]");
});

test("a form whose only filing failed is recorded failed with its cause, and the crawl goes on", async () => {
  const ok: FormHandler = async (entry) => STORED(entry.accession);
  const boom: FormHandler = async () => { throw new Error("parse failed"); };
  const d = deps();
  const result = await crawlDailyFilings(
    { db: d.db, client: d.client, objectStore: {} as never },
    { date: new Date("2026-06-12T00:00:00Z"), handlers: { "4": boom, "8-K": ok } },
  );
  const failures = [{ accession: "0000320193-26-000050", cause: "parse failed" }];
  assert.equal(result.byForm["4"].status, "failed", "nothing ingested and a failure is not a partial day");
  assert.deepEqual(result.byForm["4"].failures, failures);
  assert.equal(ledgerRow(d.ledger, "4")?.[2], "failed");
  assert.equal(ledgerRow(d.ledger, "4")?.[7], JSON.stringify(failures));
  assert.equal(result.byForm["8-K"].status, "succeeded");
  assert.equal(ledgerRow(d.ledger, "8-K")?.[7], "[]");
});

test("a form that ingested some filings and failed one is partial, with the failed filing's cause", async () => {
  const second = { ...ENTRIES[0]!, accession: "0000320193-26-000051", fileName: "edgar/data/320193/0000320193-26-000051.txt" };
  const handler: FormHandler = async (entry) => {
    if (entry.accession === second.accession) throw new Error("SEC EDGAR fetch failed (503)");
    return STORED(entry.accession);
  };
  const d = deps({ entries: [ENTRIES[0]!, second] });
  const result = await crawlDailyFilings(
    { db: d.db, client: d.client, objectStore: {} as never },
    { date: new Date("2026-06-12T00:00:00Z"), handlers: { "4": handler } },
  );
  const failures = [{ accession: second.accession, cause: "SEC EDGAR fetch failed (503)" }];
  assert.deepEqual(result.byForm["4"], { total: 2, ingested: 1, skipped: 1, status: "partial", skipReasons: {}, failures });
  assert.equal(ledgerRow(d.ledger, "4")?.[2], "partial");
  assert.equal(ledgerRow(d.ledger, "4")?.[7], JSON.stringify(failures));
});

test("a dedup (DB) failure aborts the crawl instead of silently skipping", async () => {
  const handler: FormHandler = async (entry) => STORED(entry.accession);
  const db = {
    query: async (sql: string) => {
      if (/from documents/i.test(sql)) throw new Error("db down");
      return { rows: [] } as never;
    },
  } as unknown as QueryExecutor;
  const client = { fetchDailyIndex: async (_d: Date) => ENTRIES } as never;
  await assert.rejects(
    crawlDailyFilings(
      { db, client, objectStore: {} as never },
      { date: new Date("2026-06-12T00:00:00Z"), handlers: { "4": handler } },
    ),
    /db down/,
  );
});
