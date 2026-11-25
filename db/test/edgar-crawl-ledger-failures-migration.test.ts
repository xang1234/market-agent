import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, expectRejected, startServer } from "./financial-migration-helpers.ts";

const row = (form: string, status: string, failures?: string) =>
  `insert into edgar_crawl_ledger (form, index_date, status, filings_total, filings_ingested, filings_skipped, started_at${failures === undefined ? "" : ", failures"})
   values ('${form}', '2026-06-12', '${status}', 2, 1, 1, now() - interval '1 minute'${failures === undefined ? "" : `, '${failures}'::jsonb`})`;
const CAUSE = `[{"accession": "0000320193-26-000051", "cause": "SEC EDGAR fetch failed (503)"}]`;

test("0089 edgar crawl ledger failures", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "crawl-ledger-failures-0089");
  const db = await createDatabase(t, server, "crawl_ledger_failures_0089");
  await applyCanonicalSchema(db);

  await t.test("a partial or failed day keeps its causes, and a succeeded day has none", async () => {
    await db.query(row("4", "partial", CAUSE));
    await db.query(row("8-K", "succeeded"));
    await expectRejected(db, row("13F-HR", "partial"), /edgar_crawl_ledger_cause_check/);
    await expectRejected(db, row("13F-HR", "failed", "[]"), /edgar_crawl_ledger_cause_check/);
    await expectRejected(db, row("13F-HR", "succeeded", CAUSE), /edgar_crawl_ledger_cause_check/);
    await expectRejected(db, row("13F-HR", "partial", `{"cause": "x"}`), /edgar_crawl_ledger_failures_check/);
  });

  await t.test("up marks a day recorded partial before causes were kept as having an unknown cause", async () => {
    await db.query(`delete from edgar_crawl_ledger`);
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0089", "down");
    assert.equal((await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'edgar_crawl_ledger' and column_name = 'failures'`)).rows[0].n, 0);
    await db.query(row("4", "partial"));
    await db.query(row("8-K", "succeeded"));
    await applyMigration(db, "0089", "up");
    await applyMigration(db, "0089", "up");
    const rows = (await db.query(`select form, failures from edgar_crawl_ledger order by form`)).rows;
    assert.deepEqual(rows, [
      { form: "4", failures: [{ accession: null, cause: "not recorded: this day was crawled before migration 0089 kept causes" }] },
      { form: "8-K", failures: [] },
    ]);
    await db.query(`delete from edgar_crawl_ledger`);
    assert.deepEqual(await catalogSnapshot(db), canonical);
  });
});
