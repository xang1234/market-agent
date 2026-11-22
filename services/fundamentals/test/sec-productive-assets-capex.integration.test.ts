// Capex a filer tags as PaymentsToAcquireProductiveAssets instead of
// PaymentsToAcquirePropertyPlantAndEquipment certifies (operator 2026-11-21,
// #731), recording that concept, since productive assets may include purchased
// intangibles. A filing that tags both keeps PP&E, a later one included.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { createSecCompanyFactsHttpFetcher } from "../src/sec-edgar-http.ts";
import { backfillSecCompanionStatements, createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";
import { selectFiscalYear } from "./financial-selection.ts";

const ISSUER_ID = "34731000-0000-4000-8000-000000000001";
const FALLBACK_SOURCE_ID = "34731000-0000-4000-8000-000000000003";
const SCOPE = { kind: "productive_assets_capex", concept: "PaymentsToAcquireProductiveAssets" };

type Value = { start: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string };
type Period = "Q1" | "Q2" | "Q3" | "Q4" | "FY";

// Each fiscal year's 10-K, filed the February after it ends.
const tenK = (fy: number) => ({ accn: `0000000731-${String(fy + 1).slice(2)}-000001`, fy, fp: "FY", form: "10-K", filed: `${fy + 1}-02-01` });
const year = (filing: number, of: number, val: number): Value => ({ start: `${of}-01-01`, end: `${of}-12-31`, val, ...tenK(filing) });

function companyFacts(capex: Record<string, Value[]>): string {
  const byConcept = { Revenues: [year(2024, 2024, 1000)], NetCashProvidedByUsedInOperatingActivities: [year(2024, 2024, 120)], ...capex };
  return JSON.stringify({
    cik: 731,
    entityName: "Capex Corp",
    facts: { "us-gaap": Object.fromEntries(Object.entries(byConcept).map(([concept, values]) => [concept, { label: "", description: "", units: { USD: values } }])) },
  });
}

async function setUp(t: test.TestContext, name: string) {
  const { databaseUrl } = await bootstrapDatabase(t, name);
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Capex Corp', '731')`, [ISSUER_ID]);
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
  const capex = async () => (await db.query<{ fact_id: string; method: string; value: string; flags: unknown[]; certified: boolean }>(
    `select f.fact_id::text as fact_id, f.method::text as method, f.value_num::text as value, f.quality_flags as flags,
            exists (select 1 from fact_financial_contexts c where c.fact_id = f.fact_id) as certified
       from facts f join metrics m on m.metric_id = f.metric_id
      where f.subject_id = $1 and m.metric_key = 'capex' and f.invalidated_at is null
      order by f.method, f.created_at`,
    [ISSUER_ID],
  )).rows;
  const shown = async () => (await capex()).map(({ fact_id: _, ...row }) => row);
  const relations = async () => (await db.query<{ method: string; value: string; flags: unknown[]; relation: string | null }>(
    `select f.method::text as method, f.value_num::text as value, f.quality_flags as flags, c.disclosure_relation as relation
       from facts f join metrics m on m.metric_id = f.metric_id left join fact_financial_contexts c on c.fact_id = f.fact_id
      where f.subject_id = $1 and m.metric_key = 'capex' and f.invalidated_at is null
      order by f.method, f.created_at`,
    [ISSUER_ID],
  )).rows;
  const picked = async (basis: "as_reported" | "as_restated", fiscalPeriod: Period = "FY") => {
    const selection = await selectFiscalYear(db, { issuerId: ISSUER_ID, metricKey: "capex", fiscalYear: 2024, fiscalPeriod }, "2026-06-01T00:00:00Z", basis);
    return selection.status === "selected" ? selection.input.candidate.value_text : selection.reason_code;
  };
  return { db, download, lookup, backfill, capex, shown, relations, picked };
}

test("capex filed as productive assets certifies with its concept recorded", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for certification coverage");
    return;
  }

  await t.test("a filing that tags only productive assets certifies that figure, scoped", async (t) => {
    const { download, lookup, shown } = await setUp(t, "fin-capex-productive-only");
    download.text = companyFacts({ PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30)] });
    await lookup();
    assert.deepEqual(await shown(), [{ method: "reported", value: "30", flags: [SCOPE], certified: true }]);
  });

  await t.test("a filing that tags both keeps PP&E, unscoped, and stores one capex figure", async (t) => {
    const { download, lookup, shown } = await setUp(t, "fin-capex-both-tags");
    download.text = companyFacts({
      PaymentsToAcquirePropertyPlantAndEquipment: [year(2024, 2024, 25)],
      PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30)],
    });
    await lookup();
    assert.deepEqual(await shown(), [{ method: "reported", value: "25", flags: [], certified: true }]);
  });

  await t.test("a productive-assets capex stored uncertified before #731 certifies on the next backfill, as the same fact", async (t) => {
    const { db, download, lookup, backfill, capex, shown } = await setUp(t, "fin-capex-productive-legacy");
    download.text = companyFacts({ PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30)] });
    await lookup();
    const [stored] = await capex();
    // As ingestion left it before #731, and as 0057 left a briefly certified one.
    await db.query(`delete from fact_financial_contexts where fact_id = $1`, [stored!.fact_id]);
    await db.query(`update facts set quality_flags = '[]'::jsonb where fact_id = $1`, [stored!.fact_id]);
    assert.deepEqual(await shown(), [{ method: "reported", value: "30", flags: [], certified: false }]);

    await backfill();
    assert.deepEqual(await capex(), [{ fact_id: stored!.fact_id, method: "reported", value: "30", flags: [SCOPE], certified: true }]);
    await backfill();
    assert.deepEqual(await capex(), [{ fact_id: stored!.fact_id, method: "reported", value: "30", flags: [SCOPE], certified: true }], "a rerun adds nothing");
  });

  await t.test("a later 10-K's restatement of productive-assets capex keeps the scope", async (t) => {
    const { download, lookup, shown, picked } = await setUp(t, "fin-capex-productive-restated");
    download.text = companyFacts({ PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30), year(2025, 2024, 31), year(2025, 2025, 40)] });
    await lookup();
    assert.deepEqual(await shown(), [
      { method: "reported", value: "30", flags: [SCOPE], certified: true },
      { method: "restated", value: "31", flags: [SCOPE], certified: true },
    ]);
    assert.equal(await picked("as_restated"), "31");
  });

  // A later 10-K's capex for the year is its PP&E line when it has one, as for
  // the original filing. Unless equal, a narrower line cannot tell an economic
  // change from a change of scope.
  await t.test("a later 10-K that tags both reads as PP&E, so it is an unverified restatement, never the broader line", async (t) => {
    const { download, lookup, backfill, relations, picked } = await setUp(t, "fin-capex-productive-later-both");
    download.text = companyFacts({
      PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30), year(2025, 2024, 35), year(2025, 2025, 40)],
      PaymentsToAcquirePropertyPlantAndEquipment: [year(2025, 2024, 25), year(2025, 2025, 28)],
    });
    await lookup();
    const rows = [
      { method: "reported", value: "30", flags: [SCOPE], relation: "original" },
      { method: "restated", value: "25", flags: [], relation: "unverified_restatement" },
    ];
    assert.deepEqual(await relations(), rows);
    assert.deepEqual([await picked("as_reported"), await picked("as_restated")], ["30", "restatement_unverified"]);
    await backfill();
    assert.deepEqual(await relations(), rows, "a rerun adds nothing");
  });

  // The 10-K's PP&E line repeats the figure, so it was its productive-asset line that moved.
  await t.test("a later 10-K that tags an equal PP&E figure and a changed productive-assets one restates the productive-assets figure", async (t) => {
    const { download, lookup, backfill, relations, picked } = await setUp(t, "fin-capex-productive-later-both-equal");
    download.text = companyFacts({
      PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30), year(2025, 2024, 35), year(2025, 2025, 40)],
      PaymentsToAcquirePropertyPlantAndEquipment: [year(2025, 2024, 30), year(2025, 2025, 28)],
    });
    await lookup();
    const rows = [
      { method: "reported", value: "30", flags: [SCOPE], relation: "original" },
      { method: "restated", value: "35", flags: [SCOPE], relation: "economic_restatement" },
    ];
    assert.deepEqual(await relations(), rows);
    assert.deepEqual([await picked("as_reported"), await picked("as_restated")], ["30", "35"]);
    await backfill();
    assert.deepEqual(await relations(), rows, "a rerun adds nothing");
  });

  // FY2024's quarters derive from year-to-date productive-asset lines, and the
  // FY2025 filings state FY2024's figures as PP&E: Q1 4 (was 5), six months 15
  // (was 12), the year 26 (was 30). A derived quarter reads its inputs' later
  // lines in either concept, so none stands on a figure a later filing moved.
  await t.test("a derived quarter of productive-assets capex is unverified from the filing that states one of its inputs as a different PP&E figure", async (t) => {
    const { download, lookup, relations, picked } = await setUp(t, "fin-capex-productive-derived-quarters");
    const filed = (accn: string, fy: number, fp: string, form: string, date: string) => (start: string, end: string, val: number): Value => ({ start, end, val, accn, fy, fp, form, filed: date });
    const q1 = filed("0000000731-24-000101", 2024, "Q1", "10-Q", "2024-05-01");
    const q2 = filed("0000000731-24-000102", 2024, "Q2", "10-Q", "2024-08-01");
    const q3 = filed("0000000731-24-000103", 2024, "Q3", "10-Q", "2024-11-01");
    const k = filed("0000000731-25-000001", 2024, "FY", "10-K", "2025-02-01");
    const nextQ1 = filed("0000000731-25-000101", 2025, "Q1", "10-Q", "2025-05-01");
    const nextQ2 = filed("0000000731-25-000102", 2025, "Q2", "10-Q", "2025-08-01");
    const nextK = filed("0000000731-26-000001", 2025, "FY", "10-K", "2026-02-01");
    download.text = companyFacts({
      Revenues: [q1("2024-01-01", "2024-03-31", 100), q2("2024-04-01", "2024-06-30", 100), q3("2024-07-01", "2024-09-30", 100), k("2024-01-01", "2024-12-31", 400)],
      PaymentsToAcquireProductiveAssets: [q1("2024-01-01", "2024-03-31", 5), q2("2024-01-01", "2024-06-30", 12), q3("2024-01-01", "2024-09-30", 20), k("2024-01-01", "2024-12-31", 30)],
      PaymentsToAcquirePropertyPlantAndEquipment: [
        nextQ1("2024-01-01", "2024-03-31", 4), nextQ1("2025-01-01", "2025-03-31", 6),
        nextQ2("2024-01-01", "2024-06-30", 15), nextQ2("2025-01-01", "2025-06-30", 14),
        nextK("2024-01-01", "2024-12-31", 26), nextK("2025-01-01", "2025-12-31", 32),
      ],
    });
    const periods: Period[] = ["Q1", "Q2", "Q3", "Q4", "FY"];
    for (const period of periods) await lookup(period);
    const originals = (await relations()).filter((row) => row.relation === "original");
    // A derived quarter's flags also name the inputs it was derived from.
    assert.deepEqual(originals.map((row) => [row.value, row.flags.some((flag) => (flag as { kind?: string }).kind === SCOPE.kind)]), ["5", "7", "8", "10", "30"].map((value) => [value, true]));
    const asReported = await Promise.all(periods.map((period) => picked("as_reported", period)));
    const asRestated = await Promise.all(periods.map((period) => picked("as_restated", period)));
    assert.deepEqual(asReported, ["5", "7", "8", "10", "30"]);
    assert.deepEqual(asRestated, periods.map(() => "restatement_unverified"));
  });

  // CAT retagged FY2018 and FY2019 this way in its FY2020 10-K, at equal figures.
  await t.test("a later 10-K that switches to PP&E at an equal figure states the same one", async (t) => {
    const { download, lookup, relations, picked } = await setUp(t, "fin-capex-productive-switch-equal");
    download.text = companyFacts({
      PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30)],
      PaymentsToAcquirePropertyPlantAndEquipment: [year(2025, 2024, 30), year(2025, 2025, 28), year(2026, 2024, 30)],
    });
    await lookup();
    assert.deepEqual(await relations(), [{ method: "reported", value: "30", flags: [SCOPE], relation: "original" }]);
    assert.deepEqual([await picked("as_reported"), await picked("as_restated")], ["30", "30"]);
  });

  await t.test("a later 10-K that switches to PP&E at another figure is an unverified restatement", async (t) => {
    const { download, lookup, relations, picked } = await setUp(t, "fin-capex-productive-switch-changed");
    download.text = companyFacts({
      PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30)],
      PaymentsToAcquirePropertyPlantAndEquipment: [year(2025, 2024, 26), year(2025, 2025, 28)],
    });
    await lookup();
    assert.deepEqual(await relations(), [
      { method: "reported", value: "30", flags: [SCOPE], relation: "original" },
      { method: "restated", value: "26", flags: [], relation: "unverified_restatement" },
    ]);
    assert.deepEqual([await picked("as_reported"), await picked("as_restated")], ["30", "restatement_unverified"]);
  });
});
