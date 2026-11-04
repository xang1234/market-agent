// SEC restatements (#321): a later filing's changed value for an earlier period
// is stored as that period's restatement, and as-reported readers never see it.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";
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

/**
 * GE's fiscal 2024 revenue as SEC lists it (CIK 40545). Its Q1 10-Q counted GE
 * Vernova, spun off that April; its 10-K and the next Q1 10-Q state the quarter
 * without it. The 10-K's year less the three 10-Qs leaves Q4 at 3,713M, where
 * the 10-K itself states 10,812M. Net income's quarters always agree.
 */
function geFacts() {
  const filing = (accn: string, form: string, filed: string, fy: number, fp: string) => (start: string, end: string, token: string): Value =>
    ({ start, end, val: Number(token), val_token: token, accn, fy, fp, form, filed });
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
        Revenues: { label: "", description: "", units: { USD: [
          q1("2024-01-01", "2024-03-31", "16053000000"),
          q2("2024-04-01", "2024-06-30", "9094000000"),
          q3("2024-07-01", "2024-09-30", "9842000000"),
          k("2024-01-01", "2024-12-31", "38702000000"),
          k("2024-01-01", "2024-03-31", "8955000000"),
          k("2024-10-01", "2024-12-31", "10812000000"),
          nextQ1("2024-01-01", "2024-03-31", "8955000000"),
          nextQ1("2025-01-01", "2025-03-31", "9935000000"),
        ] } },
        NetIncomeLoss: { label: "", description: "", units: { USD: [
          q1("2024-01-01", "2024-03-31", "10"),
          q2("2024-04-01", "2024-06-30", "20"),
          q3("2024-07-01", "2024-09-30", "30"),
          k("2024-01-01", "2024-12-31", "100"),
          k("2024-01-01", "2024-03-31", "10"),
          k("2024-10-01", "2024-12-31", "40"),
          nextQ1("2024-01-01", "2024-03-31", "10"),
          nextQ1("2025-01-01", "2025-03-31", "11"),
        ] } },
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

    await ingestQuarter("Q1");
    assert.deepEqual(await restated(), expected, "a rerun adds nothing");
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
