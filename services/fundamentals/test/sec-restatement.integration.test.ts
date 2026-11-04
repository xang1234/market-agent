// SEC restatements (#321): a later filing's changed value for an earlier period
// is stored as that period's restatement, and as-reported readers never see it.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { backfillSecCompanionStatements, createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";
import { secCompanyFetcher } from "./fakes.ts";
import { selectFiscalYear, selectRevenue } from "./financial-selection.ts";

const ISSUER_ID = "33000000-0000-4000-8000-0000000003a1";
const FALLBACK_SOURCE_ID = "33000000-0000-4000-8000-0000000003a2";
const FY2023 = "0000320190-24-000010";
const FY2024 = "0000320190-25-000010";
const FY2025 = "0000320190-26-000010";

type Value = { start: string; end: string; val: number; val_token: string; accn: string; fy: number; fp: string; form: string; filed: string };
const year = (accn: string, fy: number, filed: string) => (calendarYear: number, token: string): Value =>
  ({ start: `${calendarYear}-01-01`, end: `${calendarYear}-12-31`, val: Number(token), val_token: token, accn, fy, fp: "FY", form: "10-K", filed });

/** Companyfacts as SEC lists it after each 10-K: every filing's values, own year and comparatives. */
function companyFacts(filings: number) {
  const k23 = year(FY2023, 2023, "2024-01-10");
  const k24 = year(FY2024, 2024, "2025-01-10");
  const k25 = year(FY2025, 2025, "2026-01-10");
  const revenue = [k23(2023, "100"), ...(filings > 1 ? [k24(2023, "95"), k24(2024, "110")] : []), ...(filings > 2 ? [k25(2023, "95"), k25(2024, "110"), k25(2025, "120")] : [])];
  const netIncome = [k23(2023, "40"), ...(filings > 1 ? [k24(2023, "40"), k24(2024, "44")] : [])];
  // FY2024's 10-K gives operating income for 2023 twice, with different values.
  const operatingIncome = [k23(2023, "20"), ...(filings > 1 ? [k24(2023, "18"), k24(2023, "19"), k24(2024, "22")] : [])];
  return {
    cik: 320190,
    entityName: "Restating Corp",
    facts: {
      "us-gaap": {
        Revenues: { label: "", description: "", units: { USD: revenue } },
        NetIncomeLoss: { label: "", description: "", units: { USD: netIncome } },
        OperatingIncomeLoss: { label: "", description: "", units: { USD: operatingIncome } },
      },
    },
  };
}

/**
 * One issuer's companyfacts after `filings` 10-Ks (FY2023 to FY2025), each
 * giving 2023 revenue as `revenue2023[i]`, under that issuer's own accessions.
 */
function restatingFacts(cik: number, revenue2023: readonly [string, string, string], filings: number) {
  const accn = (fy: number) => `${String(cik).padStart(10, "0")}-${fy + 1 - 2000}-000010`;
  const k23 = year(accn(2023), 2023, "2024-01-10");
  const k24 = year(accn(2024), 2024, "2025-01-10");
  const k25 = year(accn(2025), 2025, "2026-01-10");
  const revenue = [
    k23(2023, revenue2023[0]),
    ...(filings > 1 ? [k24(2023, revenue2023[1]), k24(2024, "110")] : []),
    ...(filings > 2 ? [k25(2023, revenue2023[2]), k25(2024, "110"), k25(2025, "120")] : []),
  ];
  const netIncome = [k23(2023, "40"), ...(filings > 1 ? [k24(2023, "40"), k24(2024, "44")] : []), ...(filings > 2 ? [k25(2024, "44"), k25(2025, "48")] : [])];
  return {
    cik,
    entityName: `Restating ${cik}`,
    facts: {
      "us-gaap": {
        Revenues: { label: "", description: "", units: { USD: revenue } },
        NetIncomeLoss: { label: "", description: "", units: { USD: netIncome } },
      },
    },
  };
}

const filing = (accn: string, form: string, filed: string, fy: number, fp: string) => (start: string, end: string, token: string): Value =>
  ({ start, end, val: Number(token), val_token: token, accn, fy, fp, form, filed });
const concept = (unit: string, values: Value[]) => ({ label: "", description: "", units: { [unit]: values } });
const Q1_2024 = ["2024-01-01", "2024-03-31"] as const;
const Q2_2024 = ["2024-04-01", "2024-06-30"] as const;
const Q3_2024 = ["2024-07-01", "2024-09-30"] as const;
const Q4_2024 = ["2024-10-01", "2024-12-31"] as const;
const FY_2024 = ["2024-01-01", "2024-12-31"] as const;

/**
 * GE's fiscal 2024 revenue as SEC lists it (CIK 40545). Its Q1 10-Q counted GE
 * Vernova, spun off that April; its 10-K and the next Q1 10-Q state the quarter
 * without it. The 10-K's year less the three 10-Qs leaves Q4 at 3,713M, where
 * the 10-K itself states 10,812M. Net income's quarters always agree.
 */
function geFacts(tenK: { firstQuarter?: boolean; fourthQuarter?: boolean } = {}) {
  const q1 = filing("0000040545-24-000113", "10-Q", "2024-04-23", 2024, "Q1");
  const q2 = filing("0000040545-24-000176", "10-Q", "2024-07-23", 2024, "Q2");
  const q3 = filing("0000040545-24-000200", "10-Q", "2024-10-22", 2024, "Q3");
  const k = filing("0000040545-25-000015", "10-K", "2025-02-03", 2024, "FY");
  const nextQ1 = filing("0000040545-25-000062", "10-Q", "2025-04-22", 2025, "Q1");
  return {
    cik: 40545,
    entityName: "GE Aerospace",
    facts: {
      "us-gaap": {
        Revenues: concept("USD", [
          q1(...Q1_2024, "16053000000"),
          q2(...Q2_2024, "9094000000"),
          q3(...Q3_2024, "9842000000"),
          k(...FY_2024, "38702000000"),
          ...(tenK.firstQuarter === false ? [] : [k(...Q1_2024, "8955000000")]),
          ...(tenK.fourthQuarter === false ? [] : [k(...Q4_2024, "10812000000")]),
          ...(tenK.firstQuarter === false ? [] : [nextQ1(...Q1_2024, "8955000000")]),
          nextQ1("2025-01-01", "2025-03-31", "9935000000"),
        ]),
        NetIncomeLoss: concept("USD", [
          q1(...Q1_2024, "10"),
          q2(...Q2_2024, "20"),
          q3(...Q3_2024, "30"),
          k(...FY_2024, "100"),
          k(...Q1_2024, "10"),
          k(...Q4_2024, "40"),
          nextQ1(...Q1_2024, "10"),
          nextQ1("2025-01-01", "2025-03-31", "11"),
        ]),
      },
    },
  };
}

test("SEC restatements", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for restatement coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-restatement");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Restating Corp', '320190')`, [ISSUER_ID]);
  const ingest = (filings: number, fiscalYear: number, completedAt: string) =>
    createSecBackedStatementRepository(db, {
      fetcher: secCompanyFetcher(() => companyFacts(filings), { completed_at: completedAt }),
      sourceId: FALLBACK_SOURCE_ID,
      logger: { warn: () => {} },
    }).find({ issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year: fiscalYear, fiscal_period: "FY" });
  const fy2023Facts = async () => (await db.query(
    `select m.metric_key, f.method::text as method, f.value_num::text as value, c.reporting_basis, c.disclosure_relation,
            (select o.method::text from facts o where o.fact_id = f.supersedes) as restates
       from facts f join metrics m on m.metric_id = f.metric_id left join fact_financial_contexts c on c.fact_id = f.fact_id
      where f.subject_id = $1 and f.fiscal_year = 2023 order by m.metric_key, f.method`,
    [ISSUER_ID],
  )).rows;
  const picked = (selection: Awaited<ReturnType<typeof selectRevenue>>) =>
    selection.status === "selected" ? selection.input.candidate.value_text : selection.reason_code;

  await t.test("a changed comparative is a restatement; an unchanged or conflicting one adds nothing", async () => {
    await ingest(1, 2023, "2024-02-01T15:00:00.000Z");
    await ingest(2, 2024, "2025-02-01T15:00:00.000Z");
    assert.deepEqual(await fy2023Facts(), [
      { metric_key: "net_income", method: "reported", value: "40", reporting_basis: "as_reported", disclosure_relation: "original", restates: null },
      { metric_key: "net_income_consolidated", method: "reported", value: "40", reporting_basis: "as_reported", disclosure_relation: "original", restates: null },
      { metric_key: "operating_income", method: "reported", value: "20", reporting_basis: "as_reported", disclosure_relation: "original", restates: null },
      { metric_key: "revenue", method: "reported", value: "100", reporting_basis: "as_reported", disclosure_relation: "original", restates: null },
      { metric_key: "revenue", method: "restated", value: "95", reporting_basis: "as_restated", disclosure_relation: "economic_restatement", restates: "reported" },
    ]);
  });

  await t.test("as-reported and as-restated selections pick different facts, each only once public", async () => {
    assert.equal(picked(await selectRevenue(db, ISSUER_ID, "2025-03-01T00:00:00Z", "as_reported")), "100");
    assert.equal(picked(await selectRevenue(db, ISSUER_ID, "2025-03-01T00:00:00Z", "as_restated")), "95");
    assert.equal(picked(await selectRevenue(db, ISSUER_ID, "2024-06-01T00:00:00Z", "as_restated")), "100", "the restatement was not public yet");
  });

  await t.test("the as-reported statement keeps the original", async () => {
    const statement = await createSecBackedStatementRepository(db, { fetcher: null, sourceId: FALLBACK_SOURCE_ID })
      .find({ issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year: 2023, fiscal_period: "FY" });
    assert.equal(statement?.lines.find((line) => line.metric_key === "revenue")?.value_num, 100);
  });

  await t.test("re-ingesting, or a later 10-K repeating the restated value, adds no restatement", async () => {
    await ingest(2, 2024, "2025-03-01T15:00:00.000Z");
    await ingest(3, 2025, "2026-02-01T15:00:00.000Z");
    assert.equal((await fy2023Facts()).filter((row) => row.method === "restated").length, 1);
  });

  await t.test("a later filing's changed figure for a quarter is that quarter's restatement (#513)", async () => {
    const issuerId = "33000000-0000-4000-8000-0000000005a1";
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'GE Aerospace', '40545')`, [issuerId]);
    const ingestQuarter = (fiscalPeriod: "Q1" | "Q2" | "Q3" | "Q4") =>
      createSecBackedStatementRepository(db, {
        fetcher: secCompanyFetcher(geFacts, { completed_at: "2025-05-01T15:00:00.000Z" }),
        sourceId: FALLBACK_SOURCE_ID,
        logger: { warn: () => {} },
      }).find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: fiscalPeriod });
    for (const quarter of ["Q1", "Q2", "Q3", "Q4"] as const) await ingestQuarter(quarter);
    const restated = async () => (await db.query(
      `select m.metric_key, f.fiscal_period, f.value_num::text as value, f.reported_at::date::text as filed, c.disclosure_relation, o.value_num::text as restates
         from facts f join metrics m on m.metric_id = f.metric_id join fact_financial_contexts c on c.fact_id = f.fact_id join facts o on o.fact_id = f.supersedes
        where f.subject_id = $1 and f.method = 'restated' order by f.fiscal_period, m.metric_key`,
      [issuerId],
    )).rows;
    const expected = [
      { metric_key: "revenue", fiscal_period: "Q1", value: "8955000000", filed: "2025-02-03", disclosure_relation: "economic_restatement", restates: "16053000000" },
      { metric_key: "revenue", fiscal_period: "Q4", value: "10812000000", filed: "2025-02-03", disclosure_relation: "economic_restatement", restates: "3713000000" },
    ];
    assert.deepEqual(await restated(), expected);

    const quarter = async (fiscalPeriod: "Q1" | "Q4", cutoff: string, basis: "as_reported" | "as_restated") =>
      picked(await selectFiscalYear(db, { issuerId, metricKey: "revenue", fiscalYear: 2024, fiscalPeriod }, cutoff, basis));
    assert.equal(await quarter("Q1", "2025-06-01T00:00:00Z", "as_reported"), "16053000000");
    assert.equal(await quarter("Q1", "2025-06-01T00:00:00Z", "as_restated"), "8955000000");
    assert.equal(await quarter("Q4", "2025-06-01T00:00:00Z", "as_reported"), "3713000000");
    assert.equal(await quarter("Q4", "2025-06-01T00:00:00Z", "as_restated"), "10812000000");

    const statement = await createSecBackedStatementRepository(db, { fetcher: null, sourceId: FALLBACK_SOURCE_ID })
      .find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: "Q1" });
    assert.equal(statement?.lines.find((line) => line.metric_key === "revenue")?.value_num, 16053000000);

    await backfillSecCompanionStatements(db, {
      issuerId,
      fetcher: secCompanyFetcher(geFacts, { completed_at: "2025-05-02T15:00:00.000Z" }),
      sourceId: FALLBACK_SOURCE_ID,
      logger: { warn: () => {} },
    });
    assert.deepEqual(await restated(), expected, "a rerun adds nothing");
  });

  let quarterIssuers = 0;
  /** An issuer of its own, with accessions of its own, for a case that turns on quarters. */
  const quarterIssuer = async () => {
    quarterIssuers += 1;
    const cik = 410000 + quarterIssuers;
    const issuerId = `33000000-0000-4000-8000-0000000006${String(quarterIssuers).padStart(2, "0")}`;
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [issuerId, `Quarterly ${cik}`, String(cik)]);
    const options = (usGaap: Record<string, unknown>, completedAt: string) => ({
      fetcher: secCompanyFetcher(() => ({ cik, entityName: `Quarterly ${cik}`, facts: { "us-gaap": usGaap } }), { completed_at: completedAt }),
      sourceId: FALLBACK_SOURCE_ID,
      logger: { warn: () => {} },
    });
    return {
      filed: (serial: number, form: string, date: string, fy: number, fp: string) =>
        filing(`${String(cik).padStart(10, "0")}-${date.slice(2, 4)}-${String(serial).padStart(6, "0")}`, form, date, fy, fp),
      ingest: async (usGaap: Record<string, unknown>, periods: ReadonlyArray<"Q1" | "Q2" | "Q3" | "Q4" | "FY">, completedAt = "2026-03-01T15:00:00.000Z", fiscalYear = 2024) => {
        for (const fiscalPeriod of periods) {
          await createSecBackedStatementRepository(db, options(usGaap, completedAt))
            .find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year: fiscalYear, fiscal_period: fiscalPeriod });
        }
      },
      backfill: (usGaap: Record<string, unknown>, completedAt: string) => backfillSecCompanionStatements(db, { issuerId, ...options(usGaap, completedAt) }),
      /** Every later statement stored: metric, period, value, filing date and relation. */
      laterStatements: async () => (await db.query(
        `select m.metric_key, f.fiscal_period, f.value_num::text as value, f.reported_at::date::text as filed, c.disclosure_relation
           from facts f join metrics m on m.metric_id = f.metric_id join fact_financial_contexts c on c.fact_id = f.fact_id
          where f.subject_id = $1 and f.method = 'restated' and f.invalidated_at is null order by f.fiscal_period, m.metric_key, f.reported_at`,
        [issuerId],
      )).rows.map((row) => [row.metric_key, row.fiscal_period, row.value, row.filed, row.disclosure_relation]),
      pick: async (fiscalPeriod: "Q1" | "Q2" | "Q3" | "Q4" | "FY", cutoff: string, basis: "as_reported" | "as_restated", metricKey = "revenue", fiscalYear = 2024) =>
        picked(await selectFiscalYear(db, { issuerId, metricKey, fiscalYear, fiscalPeriod }, cutoff, basis)),
    };
  };
  const AFTER = "2026-06-01T00:00:00Z";

  await t.test("a cutoff before a quarter's restatement reads the original, and a further restatement replaces the first", async () => {
    const issuer = await quarterIssuer();
    const q1 = issuer.filed(1, "10-Q", "2024-04-23", 2024, "Q1");
    const k = issuer.filed(2, "10-K", "2025-02-03", 2024, "FY");
    const nextQ1 = issuer.filed(3, "10-Q", "2025-04-22", 2025, "Q1");
    const atFirst = { Revenues: concept("USD", [q1(...Q1_2024, "100")]) };
    const atTenK = { Revenues: concept("USD", [q1(...Q1_2024, "100"), k(...FY_2024, "400"), k(...Q1_2024, "90")]) };
    const atNext = { Revenues: concept("USD", [q1(...Q1_2024, "100"), k(...FY_2024, "400"), k(...Q1_2024, "90"), nextQ1(...Q1_2024, "85"), nextQ1("2025-01-01", "2025-03-31", "120")]) };
    await issuer.ingest(atFirst, ["Q1"], "2024-05-01T15:00:00.000Z");
    await issuer.backfill(atTenK, "2025-03-01T15:00:00.000Z");
    await issuer.backfill(atNext, "2025-05-01T15:00:00.000Z");
    const stored = [
      ["revenue", "Q1", "90", "2025-02-03", "economic_restatement"],
      ["revenue", "Q1", "85", "2025-04-22", "economic_restatement"],
    ];
    assert.deepEqual(await issuer.laterStatements(), stored);
    assert.equal(await issuer.pick("Q1", "2024-12-01T00:00:00Z", "as_restated"), "100", "neither restatement was public yet");
    assert.equal(await issuer.pick("Q1", "2025-03-02T00:00:00Z", "as_restated"), "90");
    assert.equal(await issuer.pick("Q1", "2025-05-03T00:00:00Z", "as_restated"), "85");
    assert.equal(await issuer.pick("Q1", "2025-05-03T00:00:00Z", "as_reported"), "100");
    await issuer.backfill(atNext, "2025-05-02T15:00:00.000Z");
    assert.deepEqual(await issuer.laterStatements(), stored, "a second backfill adds nothing");
  });

  await t.test("a derived fourth quarter is unverified from the filing that changes the year it was derived from", async () => {
    const issuer = await quarterIssuer();
    const q1 = issuer.filed(1, "10-Q", "2024-04-23", 2024, "Q1");
    const q2 = issuer.filed(2, "10-Q", "2024-07-23", 2024, "Q2");
    const q3 = issuer.filed(3, "10-Q", "2024-10-22", 2024, "Q3");
    const k = issuer.filed(4, "10-K", "2025-02-03", 2024, "FY");
    const nextK = issuer.filed(5, "10-K", "2026-02-03", 2025, "FY");
    const quarters = [q1(...Q1_2024, "100"), q2(...Q2_2024, "100"), q3(...Q3_2024, "100"), k(...FY_2024, "400")];
    await issuer.ingest({ Revenues: concept("USD", quarters) }, ["Q1", "Q2", "Q3", "Q4", "FY"], "2025-03-01T15:00:00.000Z");
    assert.equal(await issuer.pick("Q4", "2025-06-01T00:00:00Z", "as_restated"), "100");
    await issuer.backfill({ Revenues: concept("USD", [...quarters, nextK(...FY_2024, "390"), nextK("2025-01-01", "2025-12-31", "500")]) }, "2026-03-01T15:00:00.000Z");
    assert.deepEqual(await issuer.laterStatements(), [
      ["revenue", "FY", "390", "2026-02-03", "economic_restatement"],
      ["revenue", "Q4", "100", "2026-02-03", "unverified_restatement"],
    ]);
    assert.equal(await issuer.pick("FY", AFTER, "as_restated"), "390");
    assert.equal(await issuer.pick("Q4", AFTER, "as_restated"), "restatement_unverified");
    assert.equal(await issuer.pick("Q4", AFTER, "as_reported"), "100");
    assert.equal(await issuer.pick("Q4", "2025-06-01T00:00:00Z", "as_restated"), "100", "the restating filing was not public yet");
  });

  await t.test("a derived cash flow quarter is unverified from the filing that changes its year to date", async () => {
    const issuer = await quarterIssuer();
    const q1 = issuer.filed(1, "10-Q", "2024-04-23", 2024, "Q1");
    const q2 = issuer.filed(2, "10-Q", "2024-07-23", 2024, "Q2");
    const nextQ2 = issuer.filed(3, "10-Q", "2025-07-23", 2025, "Q2");
    await issuer.ingest({
      Revenues: concept("USD", [q1(...Q1_2024, "100"), q2(...Q2_2024, "100")]),
      NetCashProvidedByUsedInOperatingActivities: concept("USD", [q1(...Q1_2024, "50"), q2("2024-01-01", "2024-06-30", "120"), nextQ2("2024-01-01", "2024-06-30", "90"), nextQ2("2025-01-01", "2025-06-30", "130")]),
    }, ["Q1", "Q2"], "2025-08-01T15:00:00.000Z");
    assert.deepEqual(await issuer.laterStatements(), [["operating_cash_flow", "Q2", "70", "2025-07-23", "unverified_restatement"]]);
    assert.equal(await issuer.pick("Q2", AFTER, "as_restated", "operating_cash_flow"), "restatement_unverified");
    assert.equal(await issuer.pick("Q2", AFTER, "as_reported", "operating_cash_flow"), "70");
  });

  await t.test("GE without the 10-K's fourth-quarter line: the first quarter restates, and the stale fourth quarter is a gap", async () => {
    const issuerId = "33000000-0000-4000-8000-0000000005a2";
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'GE Aerospace', '40546')`, [issuerId]);
    const facts = { ...geFacts({ fourthQuarter: false }), cik: 40546 };
    for (const fiscalPeriod of ["Q1", "Q2", "Q3", "Q4"] as const) {
      await createSecBackedStatementRepository(db, { fetcher: secCompanyFetcher(() => facts, { completed_at: "2025-05-01T15:00:00.000Z" }), sourceId: FALLBACK_SOURCE_ID, logger: { warn: () => {} } })
        .find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: fiscalPeriod });
    }
    const quarter = async (fiscalPeriod: "Q1" | "Q4") => picked(await selectFiscalYear(db, { issuerId, metricKey: "revenue", fiscalYear: 2024, fiscalPeriod }, "2025-06-01T00:00:00Z", "as_restated"));
    assert.deepEqual([await quarter("Q1"), await quarter("Q4")], ["8955000000", "restatement_unverified"]);
  });

  await t.test("a derived fourth quarter's line is taken only when the year's quarters then sum to the year", async () => {
    const issuer = await quarterIssuer();
    const q1 = issuer.filed(1, "10-Q", "2024-04-23", 2024, "Q1");
    const q2 = issuer.filed(2, "10-Q", "2024-07-23", 2024, "Q2");
    const q3 = issuer.filed(3, "10-Q", "2024-10-22", 2024, "Q3");
    const k = issuer.filed(4, "10-K", "2025-02-03", 2024, "FY");
    await issuer.ingest({
      Revenues: concept("USD", [q1(...Q1_2024, "16053000000"), q2(...Q2_2024, "9094000000"), q3(...Q3_2024, "9842000000"), k(...FY_2024, "38702000000"), k(...Q4_2024, "10812000000")]),
    }, ["Q1", "Q2", "Q3", "Q4", "FY"], "2025-03-01T15:00:00.000Z");
    assert.deepEqual(await issuer.laterStatements(), [["revenue", "Q4", "10812000000", "2025-02-03", "unverified_restatement"]]);
    const cutoff = "2025-03-15T00:00:00Z";
    assert.equal(await issuer.pick("Q4", cutoff, "as_restated"), "restatement_unverified", "16,053M + 9,094M + 9,842M + 10,812M is 45,801M, against a year of 38,702M");
    assert.equal(await issuer.pick("Q4", cutoff, "as_reported"), "3713000000");
  });

  await t.test("an equal figure supersedes nothing, even with no split history to read", async () => {
    const issuer = await quarterIssuer();
    const q1 = issuer.filed(1, "10-Q", "2024-04-23", 2024, "Q1");
    const nextQ1 = issuer.filed(2, "10-Q", "2025-04-22", 2025, "Q1");
    await issuer.ingest({
      Revenues: concept("USD", [q1(...Q1_2024, "100"), nextQ1(...Q1_2024, "100")]),
      EarningsPerShareDiluted: concept("USD/shares", [q1(...Q1_2024, "1.23"), nextQ1(...Q1_2024, "1.23")]),
    }, ["Q1"]);
    assert.deepEqual(await issuer.laterStatements(), []);
    assert.equal(await issuer.pick("Q1", AFTER, "as_restated", "eps_diluted"), "1.23");
  });

  await t.test("a change of rounding is no restatement, in a quarter, a derived quarter or a year", async () => {
    const issuer = await quarterIssuer();
    const q1 = issuer.filed(1, "10-Q", "2024-04-23", 2024, "Q1");
    const q2 = issuer.filed(2, "10-Q", "2024-07-23", 2024, "Q2");
    const q3 = issuer.filed(3, "10-Q", "2024-10-22", 2024, "Q3");
    const k = issuer.filed(4, "10-K", "2025-02-03", 2024, "FY");
    const nextQ1 = issuer.filed(5, "10-Q", "2025-04-22", 2025, "Q1");
    const nextK = issuer.filed(6, "10-K", "2026-02-03", 2025, "FY");
    await issuer.ingest({
      // Thousands in its first year's 10-Qs, then millions.
      Revenues: concept("USD", [
        q1(...Q1_2024, "9000123000"), q2(...Q2_2024, "9000456000"), q3(...Q3_2024, "9000789000"), k(...FY_2024, "38702000000"), k(...Q4_2024, "11701000000"),
        nextQ1(...Q1_2024, "9000000000"), nextQ1("2025-01-01", "2025-03-31", "9935000000"),
        nextK(...FY_2024, "38702400000"), nextK("2025-01-01", "2025-12-31", "41000000000"),
      ]),
    }, ["Q1", "Q2", "Q3", "Q4", "FY"]);
    assert.deepEqual(await issuer.laterStatements(), []);
    assert.equal(await issuer.pick("Q4", AFTER, "as_restated"), "11700632000");
    assert.equal(await issuer.pick("Q1", AFTER, "as_restated"), "9000123000");
  });

  await t.test("a figure's own zeros are no rounding: 16,000M then 15,800M is a restatement", async () => {
    const issuer = await quarterIssuer();
    const k = issuer.filed(1, "10-K", "2025-02-03", 2024, "FY");
    const nextK = issuer.filed(2, "10-K", "2026-02-03", 2025, "FY");
    await issuer.ingest({ Revenues: concept("USD", [k(...FY_2024, "16000000000"), nextK(...FY_2024, "15800000000"), nextK("2025-01-01", "2025-12-31", "500")]) }, ["FY"]);
    assert.deepEqual(await issuer.laterStatements(), [["revenue", "FY", "15800000000", "2026-02-03", "economic_restatement"]]);
  });

  await t.test("a filing older than the original never restates it, for a quarter or a year", async () => {
    const issuer = await quarterIssuer();
    const own = issuer.filed(1, "10-Q", "2024-04-23", 2024, "Q1");
    const mistagged = issuer.filed(2, "10-Q", "2025-04-22", 2024, "Q1");
    const ownK = issuer.filed(3, "10-K", "2025-02-03", 2024, "FY");
    const mistaggedK = issuer.filed(4, "10-K", "2026-02-03", 2024, "FY");
    await issuer.ingest({ Revenues: concept("USD", [own(...Q1_2024, "100"), mistagged(...Q1_2024, "90"), ownK(...FY_2024, "400"), mistaggedK(...FY_2024, "380")]) }, ["Q1", "FY"]);
    assert.deepEqual(await issuer.laterStatements(), []);
    assert.equal(await issuer.pick("Q1", AFTER, "as_restated"), "90");
    assert.equal(await issuer.pick("FY", AFTER, "as_restated"), "380");
  });

  await t.test("an amendment states a later figure but is never the original", async () => {
    const issuer = await quarterIssuer();
    const q1 = issuer.filed(1, "10-Q", "2024-04-23", 2024, "Q1");
    const q1a = issuer.filed(2, "10-Q/A", "2024-06-10", 2024, "Q1");
    const k = issuer.filed(3, "10-K", "2025-02-03", 2024, "FY");
    const ka = issuer.filed(4, "10-K/A", "2025-03-10", 2024, "FY");
    await issuer.ingest({ Revenues: concept("USD", [q1(...Q1_2024, "100"), q1a(...Q1_2024, "80"), k(...FY_2024, "400"), ka(...FY_2024, "370")]) }, ["Q1", "FY"]);
    assert.deepEqual(await issuer.laterStatements(), [
      ["revenue", "FY", "370", "2025-03-10", "economic_restatement"],
      ["revenue", "Q1", "80", "2024-06-10", "economic_restatement"],
    ]);
    assert.equal(await issuer.pick("Q1", AFTER, "as_reported"), "100");
    assert.equal(await issuer.pick("Q1", AFTER, "as_restated"), "80");
    assert.equal(await issuer.pick("FY", AFTER, "as_reported"), "400");
    assert.equal(await issuer.pick("FY", AFTER, "as_restated"), "370");
  });

  let issuers = 0;
  const restatingIssuer = async (revenue2023: readonly [string, string, string]) => {
    issuers += 1;
    const issuerId = `33000000-0000-4000-8000-0000000004${String(issuers).padStart(2, "0")}`;
    const cik = 320190 + issuers;
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [issuerId, `Restating ${cik}`, String(cik)]);
    const ingestYear = (fiscalYear: number, filings: number, completedAt: string) =>
      createSecBackedStatementRepository(db, {
        fetcher: secCompanyFetcher(() => restatingFacts(cik, revenue2023, filings), { completed_at: completedAt }),
        sourceId: FALLBACK_SOURCE_ID,
        logger: { warn: () => {} },
      }).find({ issuer_id: issuerId, family: "income", basis: "as_reported", fiscal_year: fiscalYear, fiscal_period: "FY" });
    const restatedRevenue = async () => (await db.query<{ value: string; restates: string }>(
      `select f.value_num::text as value, o.method::text || ':' || o.value_num::text as restates
         from facts f join metrics m on m.metric_id = f.metric_id join facts o on o.fact_id = f.supersedes
        where f.subject_id = $1 and f.fiscal_year = 2023 and f.method = 'restated' and m.metric_key = 'revenue'
        order by f.reported_at`,
      [issuerId],
    )).rows;
    const storedRows = async () => (await db.query<{ facts: number; contexts: number; precision: number }>(
      `select count(*)::int as facts, count(c.fact_id)::int as contexts,
              (select count(*)::int from fact_precision_attestations a join facts g on g.fact_id = a.fact_id where g.subject_id = $1) as precision
         from facts f left join fact_financial_contexts c on c.fact_id = f.fact_id where f.subject_id = $1`,
      [issuerId],
    )).rows[0];
    const asRestated = async (cutoff: string) => picked(await selectRevenue(db, issuerId, cutoff, "as_restated"));
    return { ingestYear, restatedRevenue, storedRows, asRestated };
  };

  await t.test("a restatement is recorded when the year it restates is ingested after the restating 10-K", async () => {
    const issuer = await restatingIssuer(["100", "95", "93"]);
    await issuer.ingestYear(2024, 2, "2025-02-01T15:00:00.000Z");
    await issuer.ingestYear(2023, 2, "2025-02-02T15:00:00.000Z");
    assert.deepEqual(await issuer.restatedRevenue(), [{ value: "95", restates: "reported:100" }]);
    assert.equal(await issuer.asRestated("2025-03-01T00:00:00Z"), "95");

    await issuer.ingestYear(2025, 3, "2026-02-01T15:00:00.000Z");
    assert.deepEqual(await issuer.restatedRevenue(), [{ value: "95", restates: "reported:100" }, { value: "93", restates: "reported:100" }]);
    assert.equal(await issuer.asRestated("2025-06-01T00:00:00Z"), "95", "the second restatement was not filed yet");
    assert.equal(await issuer.asRestated("2026-04-01T00:00:00Z"), "93");

    const before = await issuer.storedRows();
    for (const fiscalYear of [2023, 2024, 2025]) await issuer.ingestYear(fiscalYear, 3, "2026-05-01T15:00:00.000Z");
    assert.deepEqual(await issuer.storedRows(), before);
  });

  await t.test("an original whose stored text is longer than a source token may be is still compared (#401)", async () => {
    const issuer = await restatingIssuer(["1.234567890123456789e-250", "95", "95"]);
    await issuer.ingestYear(2023, 1, "2024-02-01T15:00:00.000Z");
    await issuer.ingestYear(2024, 2, "2025-02-01T15:00:00.000Z");
    assert.deepEqual(await issuer.restatedRevenue(), [{ value: "95", restates: `reported:0.${"0".repeat(249)}1234567890123456789` }]);
    assert.equal(await issuer.asRestated("2025-03-01T00:00:00Z"), "95");
  });

  await t.test("a download that finished earlier still proves a restatement another ingest stored first (#338)", async () => {
    const issuer = await restatingIssuer(["100", "95", "93"]);
    await issuer.ingestYear(2023, 1, "2024-02-01T15:00:00.000Z");
    await issuer.ingestYear(2025, 3, "2026-06-01T15:00:00.000Z");
    await issuer.ingestYear(2024, 3, "2026-02-01T15:00:00.000Z");
    assert.equal(await issuer.asRestated("2026-03-01T00:00:00Z"), "93");
  });

  for (const order of [[2023, 2025, 2024], [2025, 2023, 2024]] as const) {
    await t.test(`a year restated twice resolves to the later-filed restatement, ingesting ${order.join(", ")}`, async () => {
      const issuer = await restatingIssuer(["100", "95", "93"]);
      const fetchedAt = ["2026-02-01T15:00:00.000Z", "2026-03-01T15:00:00.000Z", "2026-04-01T15:00:00.000Z"];
      for (const [index, fiscalYear] of order.entries()) {
        await issuer.ingestYear(fiscalYear, fiscalYear === 2023 && index === 0 ? 1 : 3, fiscalYear === 2023 && index === 0 ? "2024-02-01T15:00:00.000Z" : fetchedAt[index]!);
      }
      assert.deepEqual(await issuer.restatedRevenue(), [{ value: "95", restates: "reported:100" }, { value: "93", restates: "reported:100" }]);
      assert.equal(await issuer.asRestated("2026-04-15T00:00:00Z"), "93");

      const before = await issuer.storedRows();
      for (const fiscalYear of order) await issuer.ingestYear(fiscalYear, 3, "2026-05-01T15:00:00.000Z");
      assert.deepEqual(await issuer.storedRows(), before);
    });
  }
});
