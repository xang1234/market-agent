// A balance is certified only from a 10-K (#344). The statement contract labels
// every balance FY of its fiscal year, so a certified 10-Q balance would be read
// as the year's closing balance. A 10-Q balance is still stored, uncertified.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";
import { secCompanyFetcher } from "./fakes.ts";

const QUARTERLY_ISSUER = "34000000-0000-4000-8000-0000000003a1";
const FOURTH_QUARTER_ISSUER = "34000000-0000-4000-8000-0000000003a2";
const FALLBACK_SOURCE_ID = "34000000-0000-4000-8000-0000000003a9";

type Filing = { accn: string; fy: number; fp: string; form: string; filed: string };
const value = (filing: Filing, start: string | null, end: string, token: string) =>
  ({ ...(start === null ? {} : { start }), end, val: Number(token), val_token: token, ...filing });
const concept = (values: ReadonlyArray<ReturnType<typeof value>>) => ({ label: "", description: "", units: { USD: values } });

/** An FY2024 10-K and a Q1 FY2025 10-Q; a later 10-K repeats the Q1 balance with another value. */
function quarterlyFacts() {
  const k24 = { accn: "0000320195-25-000010", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01" };
  const q1 = { accn: "0000320195-25-000020", fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01" };
  const k25 = { accn: "0000320195-26-000010", fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-01" };
  const flow = (annual: string, quarter: string) =>
    concept([value(k24, "2024-01-01", "2024-12-31", annual), value(q1, "2025-01-01", "2025-03-31", quarter)]);
  return {
    cik: 320195,
    entityName: "Quarterly Corp",
    facts: {
      "us-gaap": {
        Revenues: flow("400", "110"),
        NetIncomeLoss: flow("40", "12"),
        NetCashProvidedByUsedInOperatingActivities: flow("48", "14"),
        Assets: concept([
          value(k24, null, "2024-12-31", "600"),
          value(q1, null, "2024-12-31", "600"),
          value(q1, null, "2025-03-31", "650"),
          value(k25, null, "2025-03-31", "640"),
        ]),
      },
    },
  };
}

/** An FY2024 10-K and its three 10-Qs: the fourth quarter is derived, and its balance is the 10-K's. */
function fourthQuarterFacts() {
  const k24 = { accn: "0000320196-25-000010", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01" };
  const quarter = (fp: string, n: number) => ({ accn: `0000320196-24-00002${n}`, fy: 2024, fp, form: "10-Q", filed: `2024-0${3 * n + 1}-28` });
  return {
    cik: 320196,
    entityName: "Fourth Quarter Corp",
    facts: {
      "us-gaap": {
        Revenues: concept([
          value(k24, "2024-01-01", "2024-12-31", "400"),
          value(quarter("Q1", 1), "2024-01-01", "2024-03-31", "100"),
          value(quarter("Q2", 2), "2024-04-01", "2024-06-30", "100"),
          value(quarter("Q3", 3), "2024-07-01", "2024-09-30", "100"),
        ]),
        Assets: concept([value(k24, null, "2024-12-31", "600")]),
      },
    },
  };
}

test("SEC balances are certified only from a 10-K", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for balance context coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-balance-context");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(
    `insert into issuers (issuer_id, legal_name, cik) values ($1, 'Quarterly Corp', '320195'), ($2, 'Fourth Quarter Corp', '320196')`,
    [QUARTERLY_ISSUER, FOURTH_QUARTER_ISSUER],
  );
  const ingest = (issuerId: string, facts: () => unknown, fiscalYear: number, fiscalPeriod: "FY" | "Q1" | "Q4") =>
    createSecBackedStatementRepository(db, {
      fetcher: secCompanyFetcher(facts, { completed_at: "2026-03-01T15:00:00.000Z" }),
      sourceId: FALLBACK_SOURCE_ID,
      logger: { warn: () => {} },
    }).find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year: fiscalYear, fiscal_period: fiscalPeriod });
  const stored = async (issuerId: string) => (await db.query(
    `select m.metric_key, f.fiscal_period::text as fiscal_period, f.period_end::text as period_end, f.method::text as method,
            f.value_num::text as value, c.disclosure_relation
       from facts f join metrics m on m.metric_id = f.metric_id left join fact_financial_contexts c on c.fact_id = f.fact_id
      where f.subject_id = $1 order by m.metric_key, f.period_end, f.method`,
    [issuerId],
  )).rows.map((row) => [row.metric_key, row.fiscal_period, row.period_end, row.method, row.value, row.disclosure_relation]);

  await t.test("a 10-Q balance is stored without a context; the 10-K balance and every flow keep theirs", async () => {
    assert.ok(await ingest(QUARTERLY_ISSUER, quarterlyFacts, 2024, "FY"));
    assert.ok(await ingest(QUARTERLY_ISSUER, quarterlyFacts, 2025, "Q1"));
    assert.deepEqual(await stored(QUARTERLY_ISSUER), [
      ["net_income", "FY", "2024-12-31", "reported", "40", "original"],
      ["net_income", "Q1", "2025-03-31", "reported", "12", "original"],
      ["net_income_consolidated", "FY", "2024-12-31", "reported", "40", "original"],
      ["net_income_consolidated", "Q1", "2025-03-31", "reported", "12", "original"],
      ["operating_cash_flow", "FY", "2024-12-31", "reported", "48", "original"],
      ["operating_cash_flow", "Q1", "2025-03-31", "reported", "14", "original"],
      ["revenue", "FY", "2024-12-31", "reported", "400", "original"],
      ["revenue", "Q1", "2025-03-31", "reported", "110", "original"],
      ["total_assets", "FY", "2024-12-31", "reported", "600", "original"],
      ["total_assets", "FY", "2025-03-31", "reported", "650", null],
    ], "the later 10-K's other value for the Q1 balance is no restatement either");
  });

  await t.test("a fourth-quarter ingest certifies the 10-K balance", async () => {
    assert.ok(await ingest(FOURTH_QUARTER_ISSUER, fourthQuarterFacts, 2024, "Q4"));
    assert.deepEqual(await stored(FOURTH_QUARTER_ISSUER), [
      ["revenue", "Q4", "2024-12-31", "reported", "100", null],
      ["total_assets", "FY", "2024-12-31", "reported", "600", "original"],
    ], "the derived quarter has no token, so no context");
  });

  await t.test("migration 0061 drops a context recorded before the fix for a 10-Q balance, and keeps every other one", async () => {
    await db.query(
      `insert into fact_financial_contexts (fact_id, context_version, period_type, dimension_scope, reporting_basis, adjustment_basis,
                                            share_basis, fiscal_calendar_version, disclosure_relation, source_context_ref)
       select f.fact_id, 'sec_companyfacts_context.v1', 'instant', 'consolidated', 'as_reported', 'unadjusted', 'not_applicable',
              'sec_filer_fiscal_year.v1', 'original', 'sec_edgar:companyfacts:CIK0000320195#Assets|USD|0000320195-25-000020|..2025-03-31'
         from facts f where f.subject_id = $1 and f.period_end = '2025-03-31' and f.period_kind = 'point' and f.method = 'reported'`,
      [QUARTERLY_ISSUER],
    );
    const certified = async () => (await db.query(`select count(*)::int as n from fact_financial_contexts`)).rows[0]!.n;
    assert.equal(await certified(), 11);
    await db.query(await readFile(join(workspaceRoot, "db", "migrations", "0061_quarter_balance_contexts.up.sql"), "utf8"));
    assert.equal(await certified(), 10);
    assert.deepEqual((await stored(QUARTERLY_ISSUER)).at(-1), ["total_assets", "FY", "2025-03-31", "reported", "650", null]);
    assert.deepEqual((await stored(FOURTH_QUARTER_ISSUER)).at(-1), ["total_assets", "FY", "2024-12-31", "reported", "600", "original"]);
  });
});
