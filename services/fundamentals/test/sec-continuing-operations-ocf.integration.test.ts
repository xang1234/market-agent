// Operating cash flow a filer tags as
// NetCashProvidedByUsedInOperatingActivitiesContinuingOperations instead of
// the total NetCashProvidedByUsedInOperatingActivities certifies (operator
// 2026-11-21, #743), recording that concept, since it excludes discontinued
// operations. A filing that tags both keeps the total, a later one included.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { createSecCompanyFactsHttpFetcher } from "../src/sec-edgar-http.ts";
import { backfillSecCompanionStatements, createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";
import { selectFiscalYear } from "./financial-selection.ts";

const ISSUER_ID = "34743000-0000-4000-8000-000000000001";
const FALLBACK_SOURCE_ID = "34743000-0000-4000-8000-000000000003";
const SCOPE = { kind: "continuing_operations_ocf", concept: "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations" };
const CONTINUING = "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations";
const TOTAL = "NetCashProvidedByUsedInOperatingActivities";

type Value = { start: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string };
type Period = "Q1" | "Q2" | "Q3" | "Q4" | "FY";

// Each fiscal year's 10-K, filed the February after it ends.
const tenK = (fy: number) => ({ accn: `0000000743-${String(fy + 1).slice(2)}-000001`, fy, fp: "FY", form: "10-K", filed: `${fy + 1}-02-01` });
const year = (filing: number, of: number, val: number): Value => ({ start: `${of}-01-01`, end: `${of}-12-31`, val, ...tenK(filing) });

function companyFacts(ocf: Record<string, Value[]>): string {
  const byConcept = { Revenues: [year(2024, 2024, 1000)], PaymentsToAcquirePropertyPlantAndEquipment: [year(2024, 2024, 30)], ...ocf };
  return JSON.stringify({
    cik: 743,
    entityName: "Continuing Corp",
    facts: { "us-gaap": Object.fromEntries(Object.entries(byConcept).map(([concept, values]) => [concept, { label: "", description: "", units: { USD: values } }])) },
  });
}

async function setUp(t: test.TestContext, name: string) {
  const { databaseUrl } = await bootstrapDatabase(t, name);
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Continuing Corp', '743')`, [ISSUER_ID]);
  const download = { text: "" };
  const fetcher = createSecCompanyFactsHttpFetcher({
    userAgent: "market-agent-test test@example.invalid",
    fetchImpl: async () => new Response(download.text, { status: 200 }),
    clock: () => new Date("2026-03-01T00:00:00.000Z"),
  });
  const options = { fetcher, sourceId: FALLBACK_SOURCE_ID, clock: () => new Date("2026-03-01T00:00:00.000Z"), logger: { warn: () => {} } } as const;
  const lookup = (fiscal_period: Period = "FY") => createSecBackedStatementRepository(db, options)
    .find({ issuer_id: ISSUER_ID, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period });
  const backfill = () => backfillSecCompanionStatements(db, { issuerId: ISSUER_ID, ...options });
  const ocf = async () => (await db.query<{ fact_id: string; method: string; value: string; flags: unknown[]; certified: boolean }>(
    `select f.fact_id::text as fact_id, f.method::text as method, f.value_num::text as value, f.quality_flags as flags,
            exists (select 1 from fact_financial_contexts c where c.fact_id = f.fact_id) as certified
       from facts f join metrics m on m.metric_id = f.metric_id
      where f.subject_id = $1 and m.metric_key = 'operating_cash_flow' and f.invalidated_at is null
      order by f.method, f.created_at`,
    [ISSUER_ID],
  )).rows;
  const shown = async () => (await ocf()).map(({ fact_id: _, ...row }) => row);
  const relations = async () => (await db.query<{ method: string; value: string; flags: unknown[]; relation: string | null }>(
    `select f.method::text as method, f.value_num::text as value, f.quality_flags as flags, c.disclosure_relation as relation
       from facts f join metrics m on m.metric_id = f.metric_id left join fact_financial_contexts c on c.fact_id = f.fact_id
      where f.subject_id = $1 and m.metric_key = 'operating_cash_flow' and f.invalidated_at is null
      order by f.method, f.created_at`,
    [ISSUER_ID],
  )).rows;
  const picked = async (basis: "as_reported" | "as_restated", fiscalPeriod: Period = "FY") => {
    const selection = await selectFiscalYear(db, { issuerId: ISSUER_ID, metricKey: "operating_cash_flow", fiscalYear: 2024, fiscalPeriod }, "2026-06-01T00:00:00Z", basis);
    return selection.status === "selected" ? selection.input.candidate.value_text : selection.reason_code;
  };
  return { db, download, lookup, backfill, ocf, shown, relations, picked };
}

test("operating cash flow filed for continuing operations certifies with its concept recorded", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for certification coverage");
    return;
  }

  await t.test("a filing that tags only continuing operations certifies that figure, scoped", async (t) => {
    const { download, lookup, shown } = await setUp(t, "fin-ocf-continuing-only");
    download.text = companyFacts({ [CONTINUING]: [year(2024, 2024, 120)] });
    await lookup();
    assert.deepEqual(await shown(), [{ method: "reported", value: "120", flags: [SCOPE], certified: true }]);
  });

  await t.test("a filing that tags both keeps the total, unscoped, and stores one OCF figure", async (t) => {
    const { download, lookup, shown } = await setUp(t, "fin-ocf-both-tags");
    download.text = companyFacts({ [TOTAL]: [year(2024, 2024, 125)], [CONTINUING]: [year(2024, 2024, 120)] });
    await lookup();
    assert.deepEqual(await shown(), [{ method: "reported", value: "125", flags: [], certified: true }]);
  });

  await t.test("a continuing-operations OCF stored uncertified before #743 certifies on the next backfill, as the same fact", async (t) => {
    const { db, download, lookup, backfill, ocf, shown } = await setUp(t, "fin-ocf-continuing-legacy");
    download.text = companyFacts({ [CONTINUING]: [year(2024, 2024, 120)] });
    await lookup();
    const [stored] = await ocf();
    // As ingestion left it before #743, and as 0060 left a briefly certified one.
    await db.query(`delete from fact_financial_contexts where fact_id = $1`, [stored!.fact_id]);
    await db.query(`update facts set quality_flags = '[]'::jsonb where fact_id = $1`, [stored!.fact_id]);
    assert.deepEqual(await shown(), [{ method: "reported", value: "120", flags: [], certified: false }]);

    await backfill();
    assert.deepEqual(await ocf(), [{ fact_id: stored!.fact_id, method: "reported", value: "120", flags: [SCOPE], certified: true }]);
    await backfill();
    assert.deepEqual(await ocf(), [{ fact_id: stored!.fact_id, method: "reported", value: "120", flags: [SCOPE], certified: true }], "a rerun adds nothing");
  });

  await t.test("a later 10-K's restatement of continuing-operations OCF keeps the scope", async (t) => {
    const { download, lookup, shown, picked } = await setUp(t, "fin-ocf-continuing-restated");
    download.text = companyFacts({ [CONTINUING]: [year(2024, 2024, 120), year(2025, 2024, 118), year(2025, 2025, 140)] });
    await lookup();
    assert.deepEqual(await shown(), [
      { method: "reported", value: "120", flags: [SCOPE], certified: true },
      { method: "restated", value: "118", flags: [SCOPE], certified: true },
    ]);
    assert.equal(await picked("as_restated"), "118");
  });

  // A later 10-K's OCF for the year is its total line when it has one, as for
  // the original filing. Unless equal, the total cannot tell an economic
  // change from discontinued operations it adds.
  await t.test("a later 10-K that tags both reads as the total, so it is an unverified restatement, never the continuing-operations line", async (t) => {
    const { download, lookup, backfill, relations, picked } = await setUp(t, "fin-ocf-continuing-later-both");
    download.text = companyFacts({
      [CONTINUING]: [year(2024, 2024, 120), year(2025, 2024, 110), year(2025, 2025, 140)],
      [TOTAL]: [year(2025, 2024, 135), year(2025, 2025, 150)],
    });
    await lookup();
    const rows = [
      { method: "reported", value: "120", flags: [SCOPE], relation: "original" },
      { method: "restated", value: "135", flags: [], relation: "unverified_restatement" },
    ];
    assert.deepEqual(await relations(), rows);
    assert.deepEqual([await picked("as_reported"), await picked("as_restated")], ["120", "restatement_unverified"]);
    await backfill();
    assert.deepEqual(await relations(), rows, "a rerun adds nothing");
  });

  // The 10-K's total repeats the figure, so it was its continuing-operations line that moved.
  await t.test("a later 10-K that tags an equal total and a changed continuing-operations figure restates the continuing-operations figure", async (t) => {
    const { download, lookup, backfill, relations, picked } = await setUp(t, "fin-ocf-continuing-later-both-equal");
    download.text = companyFacts({
      [CONTINUING]: [year(2024, 2024, 120), year(2025, 2024, 110), year(2025, 2025, 140)],
      [TOTAL]: [year(2025, 2024, 120), year(2025, 2025, 150)],
    });
    await lookup();
    const rows = [
      { method: "reported", value: "120", flags: [SCOPE], relation: "original" },
      { method: "restated", value: "110", flags: [SCOPE], relation: "economic_restatement" },
    ];
    assert.deepEqual(await relations(), rows);
    assert.deepEqual([await picked("as_reported"), await picked("as_restated")], ["120", "110"]);
    await backfill();
    assert.deepEqual(await relations(), rows, "a rerun adds nothing");
  });

  // FY2024's quarters derive from year-to-date continuing-operations lines,
  // and the FY2025 filings state FY2024's figures as the total: Q1 28 (was
  // 30), six months 70 (was 60), the year 125 (was 120). Q2 to Q4 each
  // subtract another filing's year to date, so none certifies, and the stated
  // Q1 and year are unverified from the filings that state them as a different total.
  await t.test("continuing-operations OCF derived across filings stays uncertified, and a stated figure is unverified from the filing that states it as a different total", async (t) => {
    const { download, lookup, relations, picked } = await setUp(t, "fin-ocf-continuing-derived-quarters");
    const filed = (accn: string, fy: number, fp: string, form: string, date: string) => (start: string, end: string, val: number): Value => ({ start, end, val, accn, fy, fp, form, filed: date });
    const q1 = filed("0000000743-24-000101", 2024, "Q1", "10-Q", "2024-05-01");
    const q2 = filed("0000000743-24-000102", 2024, "Q2", "10-Q", "2024-08-01");
    const q3 = filed("0000000743-24-000103", 2024, "Q3", "10-Q", "2024-11-01");
    const k = filed("0000000743-25-000001", 2024, "FY", "10-K", "2025-02-01");
    const nextQ1 = filed("0000000743-25-000101", 2025, "Q1", "10-Q", "2025-05-01");
    const nextQ2 = filed("0000000743-25-000102", 2025, "Q2", "10-Q", "2025-08-01");
    const nextK = filed("0000000743-26-000001", 2025, "FY", "10-K", "2026-02-01");
    download.text = companyFacts({
      Revenues: [q1("2024-01-01", "2024-03-31", 100), q2("2024-04-01", "2024-06-30", 100), q3("2024-07-01", "2024-09-30", 100), k("2024-01-01", "2024-12-31", 400)],
      [CONTINUING]: [q1("2024-01-01", "2024-03-31", 30), q2("2024-01-01", "2024-06-30", 60), q3("2024-01-01", "2024-09-30", 90), k("2024-01-01", "2024-12-31", 120)],
      [TOTAL]: [
        nextQ1("2024-01-01", "2024-03-31", 28), nextQ1("2025-01-01", "2025-03-31", 35),
        nextQ2("2024-01-01", "2024-06-30", 70), nextQ2("2025-01-01", "2025-06-30", 72),
        nextK("2024-01-01", "2024-12-31", 125), nextK("2025-01-01", "2025-12-31", 150),
      ],
    });
    const periods: Period[] = ["Q1", "Q2", "Q3", "Q4", "FY"];
    for (const period of periods) await lookup(period);
    const originals = (await relations()).filter((row) => row.relation === "original");
    // A derived quarter's flags also name the inputs it was derived from.
    assert.deepEqual(originals.map((row) => [row.value, row.flags.some((flag) => (flag as { kind?: string }).kind === SCOPE.kind)]), ["30", "120"].map((value) => [value, true]));
    const asReported = await Promise.all(periods.map((period) => picked("as_reported", period)));
    const asRestated = await Promise.all(periods.map((period) => picked("as_restated", period)));
    const derived = ["context_unverified", "context_unverified", "context_unverified"];
    assert.deepEqual(asReported, ["30", ...derived, "120"]);
    assert.deepEqual(asRestated, ["restatement_unverified", ...derived, "restatement_unverified"]);
  });

  // Devin on #746. The Q1 10-Q's 100 includes 30 from a business the Q2 10-Q
  // reports as discontinued, and its 150 six months excludes that business from
  // both quarters. Q2 is 80, never 150 less 100, and no filing states it.
  await t.test("a continuing-operations quarter derived across filings stays uncertified, since the perimeter can change between them", async (t) => {
    const { download, lookup, relations, picked } = await setUp(t, "fin-ocf-continuing-perimeter");
    const filed = (accn: string, fp: string, date: string) => (start: string, end: string, val: number): Value => ({ start, end, val, accn, fy: 2024, fp, form: "10-Q", filed: date });
    const q1 = filed("0000000743-24-000101", "Q1", "2024-05-01");
    const q2 = filed("0000000743-24-000102", "Q2", "2024-08-01");
    download.text = companyFacts({
      Revenues: [q1("2024-01-01", "2024-03-31", 100), q2("2024-04-01", "2024-06-30", 100)],
      [CONTINUING]: [q1("2024-01-01", "2024-03-31", 100), q2("2024-01-01", "2024-06-30", 150)],
    });
    await lookup("Q1");
    await lookup("Q2");
    assert.deepEqual((await relations()).map((row) => [row.value, row.relation]), [["100", "original"], ["50", null]]);
    assert.deepEqual([await picked("as_reported", "Q1"), await picked("as_reported", "Q2")], ["100", "context_unverified"]);
  });

  // CAT and COST switched to the total this way, CAT in its FY2019 10-K and COST in its FY2020 one.
  await t.test("a later 10-K that switches to the total at an equal figure states the same one", async (t) => {
    const { download, lookup, relations, picked } = await setUp(t, "fin-ocf-continuing-switch-equal");
    download.text = companyFacts({
      [CONTINUING]: [year(2024, 2024, 120)],
      [TOTAL]: [year(2025, 2024, 120), year(2025, 2025, 140), year(2026, 2024, 120)],
    });
    await lookup();
    assert.deepEqual(await relations(), [{ method: "reported", value: "120", flags: [SCOPE], relation: "original" }]);
    assert.deepEqual([await picked("as_reported"), await picked("as_restated")], ["120", "120"]);
  });

  await t.test("a later 10-K that switches to the total at another figure is an unverified restatement", async (t) => {
    const { download, lookup, relations, picked } = await setUp(t, "fin-ocf-continuing-switch-changed");
    download.text = companyFacts({
      [CONTINUING]: [year(2024, 2024, 120)],
      [TOTAL]: [year(2025, 2024, 126), year(2025, 2025, 140)],
    });
    await lookup();
    assert.deepEqual(await relations(), [
      { method: "reported", value: "120", flags: [SCOPE], relation: "original" },
      { method: "restated", value: "126", flags: [], relation: "unverified_restatement" },
    ]);
    assert.deepEqual([await picked("as_reported"), await picked("as_restated")], ["120", "restatement_unverified"]);
  });
});
