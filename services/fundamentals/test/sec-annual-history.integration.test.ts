// backfill:sec-statements --annual-history-years (#610): a dev DB gains a
// filer's newest N fiscal years of 10-K cash flow, balance sheet and cover
// counts from one companyfacts download, with no income on file first.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { SEC_EDGAR_FILING_SOURCE_ID } from "../src/provider-sources.ts";
import { backfillSecStatements } from "../src/sec-statements-backfill-cli.ts";
import { secCompanyFetcher } from "./fakes.ts";
import { aaplCallInputs } from "./sec-call-inputs-fixture.ts";
import { annualHistoryCompanyFacts, HISTORY_CIK } from "./sec-annual-history-fixture.ts";

const HISTORY = "38000000-0000-4000-8000-000000000610";
const AAPL = "38000000-0000-4000-8000-000000000611";
const quiet = { log: () => {}, warn: () => {}, error: () => {} };

test("--annual-history-years stores a filer's newest 10-K years from one download", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for backfill coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-annual-history");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'History Corp', $2), ($3, 'Apple Inc.', '320193')`, [HISTORY, String(HISTORY_CIK), AAPL]);
  const fetched: string[] = [];
  const history = secCompanyFetcher(annualHistoryCompanyFacts);
  const aapl = secCompanyFetcher(aaplCallInputs);
  const counting = async (path: string) => (fetched.push(path), (path.includes(String(HISTORY_CIK)) ? history : aapl)(path));
  const stored = async (issuerId: string) => (await db.query<{ metric_key: string; years: string }>(
    `select m.metric_key, string_agg(distinct f.fiscal_year::text || '=' || f.value_num::text, ' ' order by f.fiscal_year::text || '=' || f.value_num::text) as years
       from facts f join metrics m using (metric_id)
      where f.subject_id = $1 and f.fiscal_period = 'FY' and f.invalidated_at is null and f.superseded_by is null
        and m.metric_key = any(array['operating_cash_flow', 'capex', 'shares_outstanding', 'cash_and_equivalents', 'long_term_debt_noncurrent'])
      group by m.metric_key order by m.metric_key`,
    [issuerId],
  )).rows;

  // Without the option, an issuer with no income on file is not fetched.
  assert.deepEqual(await backfillSecStatements(db, counting, [HISTORY], quiet), { failures: 0 });
  assert.deepEqual([fetched, await stored(HISTORY)], [[], []]);

  assert.deepEqual(await backfillSecStatements(db, counting, [HISTORY, AAPL], quiet, 10), { failures: 0 });
  assert.deepEqual(fetched.filter((path) => path.includes("companyfacts")), ["/api/xbrl/companyfacts/CIK0000990610.json", "/api/xbrl/companyfacts/CIK0000320193.json"]);
  const years = (value: (year: number) => number) => Array.from({ length: 10 }, (_, index) => `${2017 + index}=${value(2017 + index)}`).join(" ");
  assert.deepEqual(await stored(HISTORY), [
    { metric_key: "capex", years: years(() => 200000000) },
    { metric_key: "cash_and_equivalents", years: years(() => 500000000) },
    { metric_key: "long_term_debt_noncurrent", years: years(() => 300000000) },
    // FY2017 as its own 10-K stated it, and as the FY2018 10-K restated it.
    { metric_key: "operating_cash_flow", years: years((year) => 1200000000 + 100000000 * (year - 2016)).replace("2017=1300000000", "2017=1300000000 2017=1350000000") },
    { metric_key: "shares_outstanding", years: years((year) => year >= 2020 ? 200000000 : 100000000) },
  ]);
  // The repo's AAPL fixture holds one 10-K year: its FY2026 Call inputs, stored with no income on file.
  assert.deepEqual(await stored(AAPL), [
    { metric_key: "capex", years: "2026=9041000000" },
    { metric_key: "cash_and_equivalents", years: "2026=36305000000" },
    { metric_key: "long_term_debt_noncurrent", years: "2026=68208000000" },
    { metric_key: "operating_cash_flow", years: "2026=145097000000" },
    { metric_key: "shares_outstanding", years: "2026=14532182000" },
  ]);
  const sources = await db.query(`select count(*)::int as n from facts f where f.subject_id = $1 and f.source_id = $2`, [HISTORY, SEC_EDGAR_FILING_SOURCE_ID]);
  assert.equal(sources.rows[0]!.n, 0, "every fact cites its 10-K's own source, never the fallback");
});
