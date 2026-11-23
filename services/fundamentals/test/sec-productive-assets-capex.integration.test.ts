// Capex a filer tags as PaymentsToAcquireProductiveAssets instead of
// PaymentsToAcquirePropertyPlantAndEquipment certifies (operator 2026-11-21,
// #731), recording that concept, since productive assets may include purchased
// intangibles. A filing that tags both keeps PP&E, a later one included. A
// later filing stating the year only as an equal PP&E figure restates it in
// that scope, as for continuing-operations OCF (operator 2026-11-23, #758).

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
  const pickedScope = async (basis: "as_reported" | "as_restated") => {
    const selection = await selectFiscalYear(db, { issuerId: ISSUER_ID, metricKey: "capex", fiscalYear: 2024, fiscalPeriod: "FY" }, "2026-06-01T00:00:00Z", basis);
    return selection.status === "selected" ? selection.input.candidate.inference ?? null : selection.reason_code;
  };
  const proofs = async () => (await db.query<{ value: string; locator: string; proof: string }>(
    `select f.value_num::text as value, a.source_locator as locator, a.token_proof_hash as proof
       from facts f join metrics m on m.metric_id = f.metric_id join current_fact_precision_attestations a on a.fact_id = f.fact_id
      where f.subject_id = $1 and m.metric_key = 'capex' and f.invalidated_at is null
      order by f.method, f.created_at`,
    [ISSUER_ID],
  )).rows;
  return { db, download, lookup, backfill, capex, shown, relations, picked, pickedScope, proofs };
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

  // A derived figure cannot stand on a later filing's source, so only a line stating it exactly restates it.
  await t.test("a derived quarter of productive-assets capex is unverified from a filing that states it equal only at its rounding, in either scope", async (t) => {
    const filed = (accn: string, fy: number, fp: string, form: string, date: string) => (start: string, end: string, val: number): Value => ({ start, end, val, accn, fy, fp, form, filed: date });
    const q1 = filed("0000000731-24-000101", 2024, "Q1", "10-Q", "2024-05-01");
    const q2 = filed("0000000731-24-000102", 2024, "Q2", "10-Q", "2024-08-01");
    const nextQ2 = filed("0000000731-25-000102", 2025, "Q2", "10-Q", "2025-08-01");
    const nextQ2A = filed("0000000731-25-000202", 2025, "Q2", "10-Q/A", "2025-09-01");
    const revenues = [q1("2024-01-01", "2024-03-31", 100), q2("2024-04-01", "2024-06-30", 100)];
    const derived = [q1("2024-01-01", "2024-03-31", 25_000_000), q2("2024-01-01", "2024-06-30", 55_077_000)];
    const scoped = (rows: Array<{ value: string; flags: unknown[]; relation: string | null }>) =>
      rows.map(({ value, flags, relation }) => [value, flags.some((flag) => (flag as { kind?: string }).kind === SCOPE.kind), relation]);
    const restatedProofs = async (db: Awaited<ReturnType<typeof setUp>>["db"]) => (await db.query<{ value: string; precision: string; derived: boolean }>(
      `select f.value_num::text as value, a.precision_class as precision, a.derivation is not null as derived
         from facts f join metrics m on m.metric_id = f.metric_id join current_fact_precision_attestations a on a.fact_id = f.fact_id
        where f.subject_id = $1 and m.metric_key = 'capex' and f.method = 'restated' and f.invalidated_at is null order by f.created_at`,
      [ISSUER_ID],
    )).rows;

    await t.test("the switch to PP&E", async (t) => {
      const { db, download, lookup, backfill, relations, picked } = await setUp(t, "fin-capex-derived-rescoped-rounded");
      download.text = companyFacts({
        Revenues: revenues,
        PaymentsToAcquireProductiveAssets: derived,
        PaymentsToAcquirePropertyPlantAndEquipment: [nextQ2("2024-04-01", "2024-06-30", 30_000_000), nextQ2("2025-04-01", "2025-06-30", 28_000_000)],
      });
      await lookup("Q2");
      const rows = [["30077000", true, "original"], ["30000000", false, "unverified_restatement"]];
      assert.deepEqual(scoped(await relations()), rows);
      assert.deepEqual(await restatedProofs(db), [{ value: "30000000", precision: "source_token_preserved", derived: false }], "the row states the later filing's own token");
      assert.equal(await picked("as_restated", "Q2"), "restatement_unverified");
      await backfill();
      assert.deepEqual(scoped(await relations()), rows, "a rerun adds nothing");
    });

    await t.test("the restatement back to productive assets", async (t) => {
      const { download, lookup, backfill, relations, picked } = await setUp(t, "fin-capex-derived-restated-back-rounded");
      download.text = companyFacts({
        Revenues: revenues,
        PaymentsToAcquireProductiveAssets: [...derived, nextQ2A("2024-04-01", "2024-06-30", 30_000_000), nextQ2A("2025-04-01", "2025-06-30", 28_000_000)],
        PaymentsToAcquirePropertyPlantAndEquipment: [nextQ2("2024-04-01", "2024-06-30", 30_077_000), nextQ2("2025-04-01", "2025-06-30", 28_033_000)],
      });
      await lookup("Q2");
      const rows = [["30077000", true, "original"], ["30077000", false, "economic_restatement"], ["30000000", true, "unverified_restatement"]];
      assert.deepEqual(scoped(await relations()), rows);
      assert.equal(await picked("as_restated", "Q2"), "restatement_unverified");
      await backfill();
      assert.deepEqual(scoped(await relations()), rows, "a rerun adds nothing");
    });
  });

  // Devin on #759. The next year's Q2 10-Q repeats the six-month productive-asset
  // input unchanged and states the quarter itself as PP&E.
  await t.test("a derived quarter switches to a PP&E line from a filing that also repeats its inputs unchanged, only when the line states it exactly", async (t) => {
    for (const [q1, ytd, ppe, expected] of [[5, 12, 7, "economic_restatement"], [25_000_000, 55_077_000, 30_000_000, "unverified_restatement"]] as const) {
      const { download, lookup, backfill, relations, picked } = await setUp(t, `fin-capex-derived-switch-repeated-inputs-${ppe}`);
      const filed = (accn: string, fy: number, fp: string, date: string) => (start: string, end: string, val: number): Value => ({ start, end, val, accn, fy, fp, form: "10-Q", filed: date });
      const first = filed("0000000731-24-000101", 2024, "Q1", "2024-05-01");
      const second = filed("0000000731-24-000102", 2024, "Q2", "2024-08-01");
      const next = filed("0000000731-25-000102", 2025, "Q2", "2025-08-01");
      download.text = companyFacts({
        Revenues: [first("2024-01-01", "2024-03-31", 100), second("2024-04-01", "2024-06-30", 100)],
        PaymentsToAcquireProductiveAssets: [first("2024-01-01", "2024-03-31", q1), second("2024-01-01", "2024-06-30", ytd), next("2024-01-01", "2024-06-30", ytd)],
        PaymentsToAcquirePropertyPlantAndEquipment: [next("2024-04-01", "2024-06-30", ppe), next("2025-04-01", "2025-06-30", ppe + 1_000_000)],
      });
      await lookup("Q2");
      const rows = [[String(ytd - q1), true, "original"], [String(ppe), false, expected]];
      const scoped = async () => (await relations()).map(({ value, flags, relation }) => [value, flags.some((flag) => (flag as { kind?: string }).kind === SCOPE.kind), relation]);
      assert.deepEqual(await scoped(), rows);
      assert.equal(await picked("as_restated", "Q2"), expected === "economic_restatement" ? String(ppe) : "restatement_unverified");
      await backfill();
      assert.deepEqual(await scoped(), rows, "a rerun adds nothing");
    }
  });

  // CAT retagged FY2018 and FY2019 this way in its FY2020 10-K, at equal
  // figures. The first equal PP&E line restates the year in that scope, so its
  // growth to a PP&E year counts.
  await t.test("a later 10-K that switches to PP&E at an equal figure restates the year as PP&E", async (t) => {
    const { download, lookup, backfill, relations, picked, pickedScope } = await setUp(t, "fin-capex-productive-switch-equal");
    download.text = companyFacts({
      PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30)],
      PaymentsToAcquirePropertyPlantAndEquipment: [year(2025, 2024, 30), year(2025, 2025, 28), year(2026, 2024, 30)],
    });
    await lookup();
    const rows = [
      { method: "reported", value: "30", flags: [SCOPE], relation: "original" },
      { method: "restated", value: "30", flags: [], relation: "economic_restatement" },
    ];
    assert.deepEqual(await relations(), rows);
    assert.deepEqual([await picked("as_reported"), await picked("as_restated")], ["30", "30"]);
    assert.deepEqual([await pickedScope("as_reported"), await pickedScope("as_restated")], [SCOPE, null]);
    await backfill();
    assert.deepEqual(await relations(), rows, "a rerun adds nothing");
  });

  // The row shows, locates and proves the figure that stands, from the filing that states it.
  await t.test("a PP&E figure equal only at the coarser rounding restates the year at the figure that stands", async (t) => {
    for (const [productive, ppe] of [[[30_077_000, 25_033_000], [30_000_000, 28_000_000]], [[30_000_000, 25_000_000], [30_400_000, 28_300_000]]] as const) {
      const { download, lookup, relations, pickedScope, proofs } = await setUp(t, `fin-capex-productive-switch-rounded-${productive[0]}`);
      download.text = companyFacts({
        PaymentsToAcquireProductiveAssets: [year(2024, 2024, productive[0]), year(2024, 2023, productive[1])],
        PaymentsToAcquirePropertyPlantAndEquipment: [year(2025, 2024, ppe[0]), year(2025, 2025, ppe[1])],
      });
      await lookup();
      assert.deepEqual((await relations()).map(({ value, flags, relation }) => [value, flags, relation]), [
        [String(productive[0]), [SCOPE], "original"],
        [String(productive[0]), [], "economic_restatement"],
      ]);
      assert.equal(await pickedScope("as_restated"), null);
      const [original, restated] = await proofs();
      assert.deepEqual(restated, original);
    }
  });

  await t.test("a PP&E figure equal to a restated productive-assets one restates the year as PP&E, citing the filing that restated it", async (t) => {
    const { download, lookup, relations, proofs } = await setUp(t, "fin-capex-productive-restated-switch");
    download.text = companyFacts({
      PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30_000_000), year(2024, 2023, 25_000_000), year(2025, 2024, 31_077_000), year(2025, 2025, 28_033_000)],
      PaymentsToAcquirePropertyPlantAndEquipment: [year(2026, 2024, 31_000_000), year(2026, 2026, 33_000_000)],
    });
    await lookup();
    assert.deepEqual((await relations()).map(({ value, flags, relation }) => [value, flags, relation]), [
      ["30000000", [SCOPE], "original"],
      ["31077000", [SCOPE], "economic_restatement"],
      ["31077000", [], "economic_restatement"],
    ]);
    const [, restated, rescoped] = await proofs();
    assert.deepEqual(rescoped, restated);
  });

  // A filing that tags both reads as PP&E (#731), so once the year stands as
  // PP&E it keeps it there, and only one stating productive assets alone restates it back.
  await t.test("once the year stands as PP&E a filing that tags both keeps it there, and one tagging productive assets alone restates it back", async (t) => {
    const { download, lookup, relations, pickedScope } = await setUp(t, "fin-capex-productive-switch-back");
    const tenKA = (of: number, val: number): Value => ({ ...year(2025, of, val), accn: "0000000731-26-000002", form: "10-K/A", filed: "2026-04-01" });
    download.text = companyFacts({
      PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30), tenKA(2024, 30), tenKA(2025, 28), year(2026, 2024, 30), year(2026, 2026, 33)],
      PaymentsToAcquirePropertyPlantAndEquipment: [year(2025, 2024, 30), year(2025, 2025, 28), tenKA(2024, 30), tenKA(2025, 28)],
    });
    await lookup();
    assert.deepEqual((await relations()).map(({ value, flags, relation }) => [value, flags, relation]), [
      ["30", [SCOPE], "original"],
      ["30", [], "economic_restatement"],
      ["30", [SCOPE], "economic_restatement"],
    ]);
    assert.deepEqual(await pickedScope("as_restated"), SCOPE);
  });

  // Devin on #759. A productive-assets line alone cannot tell a change of figure from a change of scope back.
  await t.test("once the year stands as PP&E a 10-K stating another productive-assets figure alone is an unverified restatement", async (t) => {
    const { download, lookup, backfill, relations, picked } = await setUp(t, "fin-capex-productive-switch-back-changed");
    download.text = companyFacts({
      PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30), year(2026, 2024, 35), year(2026, 2026, 40)],
      PaymentsToAcquirePropertyPlantAndEquipment: [year(2025, 2024, 30), year(2025, 2025, 28)],
    });
    await lookup();
    const rows = [
      ["30", [SCOPE], "original"],
      ["30", [], "economic_restatement"],
      ["35", [SCOPE], "unverified_restatement"],
    ];
    assert.deepEqual((await relations()).map(({ value, flags, relation }) => [value, flags, relation]), rows);
    assert.equal(await picked("as_restated"), "restatement_unverified");
    await backfill();
    assert.deepEqual((await relations()).map(({ value, flags, relation }) => [value, flags, relation]), rows, "a rerun adds nothing");
  });

  await t.test("a later PP&E figure that disagrees with the equal one leaves the year unverified", async (t) => {
    const { download, lookup, relations, picked } = await setUp(t, "fin-capex-productive-switch-then-changed");
    download.text = companyFacts({
      PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30)],
      PaymentsToAcquirePropertyPlantAndEquipment: [year(2025, 2024, 30), year(2025, 2025, 28), year(2026, 2024, 26), year(2026, 2026, 33)],
    });
    await lookup();
    assert.deepEqual((await relations()).map(({ value, flags, relation }) => [value, flags, relation]), [
      ["30", [SCOPE], "original"],
      ["30", [], "economic_restatement"],
      ["26", [], "unverified_restatement"],
    ]);
    assert.equal(await picked("as_restated"), "restatement_unverified");
  });

  // The original 10-K is one of that day's filings, so neither is known to be later.
  await t.test("an original 10-K and a filing the same day stating the year only as an equal PP&E figure are unverified in either accession order", async (t) => {
    for (const accn of ["0000000731-25-000000", "0000000731-25-000002"]) {
      const { download, lookup, relations, picked } = await setUp(t, `fin-capex-productive-switch-original-day-${accn}`);
      const tenKA = (val: number): Value => ({ ...year(2024, 2024, val), accn, form: "10-K/A" });
      download.text = companyFacts({ PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30), year(2024, 2023, 25)], PaymentsToAcquirePropertyPlantAndEquipment: [tenKA(30)] });
      await lookup();
      assert.deepEqual((await relations()).map(({ flags, relation }) => [flags, relation]), [[[SCOPE], "original"], [[], "unverified_restatement"]]);
      assert.equal(await picked("as_restated"), "restatement_unverified");
    }
  });

  // Devin on #755. Either would restate the year as PP&E and they disagree
  // with each other, so, as two OCF totals filed one day do, they leave it
  // unverified, though here either order stores the coarser original (#756).
  await t.test("same-day filings that each repeat the figure as a different PP&E figure within its rounding leave it unverified", async (t) => {
    for (const accn of ["0000000731-26-000000", "0000000731-26-000002"]) {
      const { download, lookup, relations, picked } = await setUp(t, `fin-capex-productive-same-day-${accn}`);
      const tenKA = (of: number, val: number): Value => ({ ...year(2025, of, val), accn, form: "10-K/A" });
      download.text = companyFacts({
        PaymentsToAcquireProductiveAssets: [year(2024, 2024, 30_000_000), year(2024, 2023, 25_000_000)],
        PaymentsToAcquirePropertyPlantAndEquipment: [year(2025, 2024, 30_400_000), year(2025, 2025, 28_123_000), tenKA(2024, 29_800_000), tenKA(2025, 28_123_000)],
      });
      await lookup();
      assert.deepEqual((await relations()).map(({ relation }) => relation), ["original", "unverified_restatement"]);
      assert.equal(await picked("as_restated"), "restatement_unverified");
    }
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
