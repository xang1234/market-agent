import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { SecEdgarFetchError } from "../../fundamentals/src/sec-edgar.ts";
import { secFetched } from "../../fundamentals/test/fakes.ts";
import { hydrateAnalyzeIssuers } from "../src/local-runtime.ts";

const LISTED = "34000000-0000-4000-8000-000000000001";
const UNREACHABLE = "34000000-0000-4000-8000-000000000002";

function annualRevenue(fy: number, val: string) {
  return { start: `${fy}-01-01`, end: `${fy}-12-31`, val: Number(val), val_token: val, accn: `0000320193-${String(fy + 1).slice(2)}-000006`, fy, fp: "FY", form: "10-K", filed: `${fy + 1}-01-10` };
}

// The latest fiscal year is last year, so the stored years stay inside a filing cycle whenever this runs.
const LATEST = new Date().getUTCFullYear() - 1;

// A balance is an instant at the 10-K's year end, stored as a point fact.
function yearEndBalance(fy: number, val: string) {
  const { start: _start, ...instant } = annualRevenue(fy, val);
  return instant;
}
const usd = (label: string, values: unknown[]) => ({ label, description: "", units: { USD: values } });

const COMPANY_FACTS = {
  cik: 320193,
  entityName: "Example Corp",
  facts: { "us-gaap": {
    Revenues: usd("Revenues", [annualRevenue(LATEST - 1, "391000000000"), annualRevenue(LATEST, "402000000000")]),
    GrossProfit: usd("Gross profit", [annualRevenue(LATEST, "180000000000")]),
    NetIncomeLoss: usd("Net income", [annualRevenue(LATEST, "95000000000")]),
    NetCashProvidedByUsedInOperatingActivities: usd("Operating cash flow", [annualRevenue(LATEST, "110000000000")]),
    Assets: usd("Assets", [yearEndBalance(LATEST, "360000000000")]),
    Liabilities: usd("Liabilities", [yearEndBalance(LATEST, "290000000000")]),
    StockholdersEquity: usd("Equity", [yearEndBalance(LATEST, "70000000000")]),
  } },
};

// What an investment memo plans for its subject: revenue for two years, the rest for the latest.
const INVESTMENT_READS = new Map([
  ["revenue", 2], ["gross_profit", 1], ["operating_cash_flow", 1], ["net_income", 1],
  ["total_assets", 1], ["total_liabilities", 1], ["total_equity", 1],
]);

const downloads: string[] = [];
const fetcher = async (path: string) => {
  downloads.push(path);
  if (path.includes("320199")) throw new SecEdgarFetchError(503, "sec_edgar: HTTP 503");
  return path.startsWith("/api/xbrl/companyfacts/")
    ? secFetched(COMPANY_FACTS, { url: `https://data.sec.gov${path}` })
    : secFetched({ filings: { recent: { accessionNumber: [], acceptanceDateTime: [] } } }, { url: `https://data.sec.gov${path}` });
};

test("an issuer gains the fiscal years its memo reads, once; an issuer SEC cannot serve is logged, not fatal", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "dev-api-analyze-hydration");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Example Corp', '320193'), ($2, 'Down Corp', '320199')`, [LISTED, UNREACHABLE]);
  const warnings: unknown[][] = [];

  await hydrateAnalyzeIssuers(db, fetcher, new Map([[LISTED, INVESTMENT_READS], [UNREACHABLE, new Map([["revenue", 1]])]]), { warn: (...args: unknown[]) => warnings.push(args) });

  const { rows } = await db.query<{ subject_id: string; fiscal_year: number; value: string }>(
    `select f.subject_id::text, f.fiscal_year, f.value_num::text as value
       from facts f join metrics m on m.metric_id = f.metric_id
      where m.metric_key = 'revenue' and f.period_kind = 'fiscal_y' order by f.subject_id, f.fiscal_year`,
  );
  assert.deepEqual(rows, [
    { subject_id: LISTED, fiscal_year: LATEST - 1, value: "391000000000" },
    { subject_id: LISTED, fiscal_year: LATEST, value: "402000000000" },
  ]);
  assert.deepEqual(downloads.filter((path) => path.includes("320193")), [
    "/api/xbrl/companyfacts/CIK0000320193.json",
    "/submissions/CIK0000320193.json",
  ], "one download serves both years");
  assert.deepEqual(warnings.at(-1), ["analyze SEC hydration failed; the engine reports the gap", { issuer_id: UNREACHABLE, reason: "provider_error", error: "sec_edgar: HTTP 503" }]);

  const before = downloads.length;
  await hydrateAnalyzeIssuers(db, fetcher, new Map([[LISTED, INVESTMENT_READS]]), { warn() {} });
  assert.deepEqual(downloads.slice(before), [], "years stored with their proofs are not downloaded again");

  // A fact the engine would reject for its missing financial context is fetched again, which records the context.
  await db.query(`delete from fact_financial_contexts c using facts f where c.fact_id = f.fact_id and f.subject_id = $1`, [LISTED]);
  const repaired = downloads.length;
  await hydrateAnalyzeIssuers(db, fetcher, new Map([[LISTED, INVESTMENT_READS]]), { warn() {} });
  assert.ok(downloads.length > repaired, "a fact without its financial context is downloaded again");
  const contexts = await db.query(`select count(*)::int as n from fact_financial_contexts c join facts f on f.fact_id = c.fact_id where f.subject_id = $1`, [LISTED]);
  assert.ok(Number(contexts.rows[0].n) > 0, "the download restores the context");
});
