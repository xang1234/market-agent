// A Call input is certified only from the concept #594 mapped to it. A concept
// later mapped beside it (as PaymentsToAcquireProductiveAssets is beside capex's
// reviewed one) is stored, readable in statements, but never certified.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { US_GAAP_TO_METRIC_KEY } from "../src/sec-edgar.ts";
import { createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";
import { secCompanyFetcher } from "./fakes.ts";

const ISSUER = "34000000-0000-4000-8000-0000000005c1";
const FLOWS = ["pretax_income", "pretax_income_before_equity_method", "income_tax_expense", "stock_based_compensation_expense", "stock_based_compensation"];
const BALANCES = [
  "long_term_debt_current",
  "long_term_debt_noncurrent",
  "commercial_paper",
  "short_term_borrowings",
  "marketable_securities_current",
  "marketable_securities_noncurrent",
  "debt_securities_current",
  "short_term_investments",
  "remaining_performance_obligations",
];
const alias = (metricKey: string) => `AliasOf_${metricKey}`;

function aliasFacts() {
  const filing = { accn: "0000320197-26-000010", fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-01" };
  const concept = (start: string | null, token: string) =>
    ({ label: "", description: "", units: { USD: [{ ...(start === null ? {} : { start }), end: "2025-12-31", val: Number(token), val_token: token, ...filing }] } });
  return {
    cik: 320197,
    entityName: "Alias Corp",
    facts: {
      "us-gaap": {
        Revenues: concept("2025-01-01", "1000"),
        ...Object.fromEntries(FLOWS.map((key, index) => [alias(key), concept("2025-01-01", String(10 + index))])),
        ...Object.fromEntries(BALANCES.map((key, index) => [alias(key), concept(null, String(100 + index))])),
      },
    },
  };
}

test("a Call input tagged under another concept is stored but not certified", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for certification coverage");
    return;
  }
  const map = US_GAAP_TO_METRIC_KEY as Record<string, string>;
  for (const key of [...FLOWS, ...BALANCES]) map[alias(key)] = key;
  t.after(() => {
    for (const key of [...FLOWS, ...BALANCES]) delete map[alias(key)];
  });
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-call-input-certification");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Alias Corp', '320197')`, [ISSUER]);

  const statements = createSecBackedStatementRepository(db, {
    fetcher: secCompanyFetcher(aliasFacts, { completed_at: "2026-03-01T15:00:00.000Z" }),
    sourceId: "34000000-0000-4000-8000-0000000005c9",
    logger: { warn: () => {} },
  });
  assert.ok(await statements.find({ issuer_id: ISSUER, family: "income", basis: "as_reported", fiscal_year: 2025, fiscal_period: "FY" }));

  const { rows } = await db.query(
    `select m.metric_key, f.value_num::text as value, c.fact_id is not null as certified
       from facts f join metrics m on m.metric_id = f.metric_id left join fact_financial_contexts c on c.fact_id = f.fact_id
      where f.subject_id = $1 order by m.metric_key`,
    [ISSUER],
  );
  assert.deepEqual(
    rows.map((row) => [row.metric_key, row.value, row.certified]),
    [
      ...FLOWS.map((key, index) => [key, String(10 + index), false]),
      ...BALANCES.map((key, index) => [key, String(100 + index), false]),
      ["revenue", "1000", true],
    ].sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
});
