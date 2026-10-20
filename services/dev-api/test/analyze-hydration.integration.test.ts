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

const COMPANY_FACTS = {
  cik: 320193,
  entityName: "Example Corp",
  facts: { "us-gaap": { Revenues: { label: "Revenues", description: "", units: { USD: [annualRevenue(2023, "380000000000"), annualRevenue(2024, "391000000000")] } } } },
};

const downloads: string[] = [];
const fetcher = async (path: string) => {
  downloads.push(path);
  if (path.includes("320199")) throw new SecEdgarFetchError(503, "sec_edgar: HTTP 503");
  return path.startsWith("/api/xbrl/companyfacts/")
    ? secFetched(COMPANY_FACTS, { url: `https://data.sec.gov${path}` })
    : secFetched({ filings: { recent: { accessionNumber: [], acceptanceDateTime: [] } } }, { url: `https://data.sec.gov${path}` });
};

test("a memo's issuers gain their latest two fiscal years; an issuer SEC cannot serve is logged, not fatal", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "dev-api-analyze-hydration");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Example Corp', '320193'), ($2, 'Down Corp', '320199')`, [LISTED, UNREACHABLE]);
  const warnings: unknown[][] = [];

  await hydrateAnalyzeIssuers(db, fetcher, new Map([[LISTED, 2], [UNREACHABLE, 1]]), { warn: (...args: unknown[]) => warnings.push(args) });

  const { rows } = await db.query<{ subject_id: string; fiscal_year: number; value: string }>(
    `select f.subject_id::text, f.fiscal_year, f.value_num::text as value
       from facts f join metrics m on m.metric_id = f.metric_id
      where m.metric_key = 'revenue' and f.period_kind = 'fiscal_y' order by f.subject_id, f.fiscal_year`,
  );
  assert.deepEqual(rows, [
    { subject_id: LISTED, fiscal_year: 2023, value: "380000000000" },
    { subject_id: LISTED, fiscal_year: 2024, value: "391000000000" },
  ]);
  assert.deepEqual(downloads.filter((path) => path.includes("320193")), [
    "/api/xbrl/companyfacts/CIK0000320193.json",
    "/submissions/CIK0000320193.json",
  ], "one download serves both years");
  assert.deepEqual(warnings.at(-1), ["analyze SEC hydration failed; the engine reports the gap", { issuer_id: UNREACHABLE, reason: "provider_error", error: "sec_edgar: HTTP 503" }]);
});
