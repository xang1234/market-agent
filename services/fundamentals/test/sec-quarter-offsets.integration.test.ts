import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bootstrapDatabase, connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { createRuntimeAuthority, type ReportedMetricNode } from "../../financial-core/src/index.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { InputCandidate } from "../../financial-engine/src/ports.ts";
import { selectInput, sharedLatestPeriods, type SelectionPolicy } from "../../financial-engine/src/select-inputs.ts";
import { backfillSecCompanionStatements, createSecBackedStatementRepository } from "../src/sec-facts-repository.ts";
import { secCompanyFetcher } from "./fakes.ts";

const ISSUER = "46900000-0000-4000-8000-000000000001";
const FALLBACK_SOURCE_ID = "46900000-0000-4000-8000-000000000009";
const OWNER = "46900000-0000-4000-8000-000000000011";
const CIK = 1234567;

type Filing = { accn: string; fy: number; fp: string; form: string; filed: string };
type Period = "Q1" | "Q2" | "Q3" | "FY";

const PERIODS: ReadonlyArray<readonly [fy: number, fp: Period, filed: string, start: string, end: string]> = [
  [2023, "Q1", "2023-05-01", "2023-01-01", "2023-03-31"],
  [2023, "Q2", "2023-08-01", "2023-04-01", "2023-06-30"],
  [2023, "Q3", "2023-11-01", "2023-07-01", "2023-09-30"],
  [2023, "FY", "2024-02-15", "2023-01-01", "2023-12-31"],
  [2024, "Q1", "2024-05-01", "2024-01-01", "2024-03-31"],
  [2024, "Q2", "2024-08-01", "2024-04-01", "2024-06-30"],
  [2024, "Q3", "2024-11-01", "2024-07-01", "2024-09-30"],
  [2024, "FY", "2025-02-15", "2024-01-01", "2024-12-31"],
  [2025, "Q1", "2025-05-01", "2025-01-01", "2025-03-31"],
];

type Quirks = { untokened?: string; filed?: Readonly<Record<string, string>> };

const filing = (cik: number, fy: number, fp: Period, filed: string): Filing =>
  ({ accn: `${String(cik).padStart(10, "0")}-${String(fy).slice(2)}-00000${fp === "FY" ? "4" : fp[1]}`, fy, fp, form: fp === "FY" ? "10-K" : "10-Q", filed });

function filings(cik: number, quirks: Quirks) {
  return PERIODS.map(([fy, fp, filed, start, end]) => [filing(cik, fy, fp, quirks.filed?.[`${fp} FY${fy}`] ?? filed), start, end] as const);
}

function companyFacts(cik: number, filed: ReadonlyArray<string>, quirks: Quirks) {
  const concept = (tokens: ReadonlyArray<string | null>, options: { unit?: string; instant?: boolean; yearToDate?: boolean } = {}) => ({
    label: "",
    description: "",
    units: {
      [options.unit ?? "USD"]: filings(cik, quirks).flatMap(([filing, start, end], index) => {
        const token = tokens[index];
        if (!filed.includes(filing.accn) || token === null) return [];
        const value = { ...(options.instant ? {} : { start: options.yearToDate ? `${filing.fy}-01-01` : start }), end, val: Number(token), ...filing };
        return [quirks.untokened === `${filing.fp} FY${filing.fy}` ? value : { ...value, val_token: token }];
      }),
    },
  });
  return {
    cik,
    entityName: "ACME CORP",
    facts: {
      "us-gaap": {
        Revenues: concept(["100", "110", "120", "460", "140", "150", "160", "620", "180"]),
        NetIncomeLoss: concept(["10", "11", "12", "46", "14", "15", "16", "62", "18"]),
        EarningsPerShareDiluted: concept(["0.1", "0.11", "0.12", "0.46", "0.14", "0.15", "0.16", "0.62", "0.18"], { unit: "USD/shares" }),
        Assets: concept([null, null, null, "1000", null, null, null, "1100", "1150"], { instant: true }),
        // A 10-Q states cash flows from the start of the fiscal year: FY2024's quarters are 40, 45, 50 and 55.
        NetCashProvidedByUsedInOperatingActivities: concept(["30", "65", "105", "150", "40", "85", "135", "190", "50"], { yearToDate: true }),
      },
    },
  };
}

const latestQuarter = (metric: string, offset: number): ReportedMetricNode => ({
  node_id: `${metric}_${offset}`,
  operation: "reported_metric",
  operation_version: "reported_metric.v1",
  subject_slot: "a",
  metric_key: metric,
  period: { kind: "latest", period_type: "quarterly", offset },
});

const named = (metric: string, fiscal_year: number, fiscal_period: "Q1" | "Q2" | "Q3" | "Q4"): ReportedMetricNode =>
  ({ ...latestQuarter(metric, 0), period: { kind: "fiscal_period", fiscal_year, fiscal_period } });

const POLICY: SelectionPolicy = { knowledge_cutoff: "2026-10-02T00:00:00.000Z", reporting_basis: "as_reported", max_age_days: null, allowed_source_classes: ["sec_filing"] };

function landed(result: ReturnType<typeof selectInput>): string {
  if (result.status === "gap") return `gap ${result.reason_code}`;
  const { fiscal_period, fiscal_year } = result.input.candidate.period;
  return `${fiscal_period === "FY" ? "" : `${fiscal_period} `}FY${fiscal_year} ${result.input.numeric.native_value}`;
}

function terms(candidate: InputCandidate | undefined): string[] {
  return (candidate?.precision?.derivation?.terms ?? []).map((term) =>
    `${term.sign} ${term.span} ${term.fiscal_period} FY${term.fiscal_year} ${term.start}..${term.end} ${term.raw_token} ${term.source.form} filed ${term.source.filed}`);
}

async function secIssuer(db: Awaited<ReturnType<typeof connectedPool>>, id: string, cik: number, quirks: Quirks = {}) {
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'ACME CORP', $2)`, [id, String(cik)]);
  const filed: string[] = [];
  const ingest = async (fiscalYear: number, periods: ReadonlyArray<Period | "Q4">, completedAt = "2026-10-01T15:00:00.000Z") => {
    filed.push(...filings(cik, quirks).filter(([filing]) => filing.fy === fiscalYear && (periods as ReadonlyArray<string>).includes(filing.fp)).map(([filing]) => filing.accn));
    const fetcher = secCompanyFetcher(() => companyFacts(cik, filed, quirks), { completed_at: completedAt });
    const repository = createSecBackedStatementRepository(db, { fetcher, sourceId: FALLBACK_SOURCE_ID, logger: { warn: () => {} } });
    for (const fiscalPeriod of periods) {
      assert.ok(await repository.find({ issuer_id: id, family: "income", basis: "as_reported", fiscal_year: fiscalYear, fiscal_period: fiscalPeriod }), `${fiscalPeriod} FY${fiscalYear}`);
    }
  };
  const candidates = async (metric: string): Promise<ReadonlyArray<InputCandidate>> => {
    const page = await createEvidenceFinancialPort(db).listInputCandidates({
      authority: createRuntimeAuthority({
        owner_user_id: OWNER,
        egress_channel: "chat",
        parent: { kind: "chat_thread", id: OWNER, version: "1" },
        allowed_source_classes: ["sec_filing"],
        feature: { surface: "chat", capability: "financial-answer", mode: "enforce" },
        approval_state: "not_required",
        lease: null,
      }),
      subject: { kind: "issuer", id },
      metric_key: metric,
      fiscal_year: null,
      fiscal_period: null,
      limit: 100,
    });
    assert.ok(page.status === "ok" && !page.truncated);
    return page.status === "ok" ? page.candidates : [];
  };
  const backfill = () =>
    backfillSecCompanionStatements(db, { issuerId: id, fetcher: secCompanyFetcher(() => companyFacts(cik, filed, quirks)), sourceId: FALLBACK_SOURCE_ID, logger: { warn: () => {} } });
  return { ingest, candidates, backfill };
}

test("latest quarterly offsets on SEC-ingested statements", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for SEC quarter offset coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "fin-sec-quarter-offsets");
  const db = await connectedPool(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  const { ingest, candidates } = await secIssuer(db, ISSUER, CIK);

  await t.test("tokened filings certify each derived Q4 with its derivation, so offsets 0 to 7 land on consecutive fiscal quarters (#481)", async () => {
    await ingest(2023, ["Q1", "Q2", "Q3", "FY", "Q4"]);
    await ingest(2024, ["Q1", "Q2", "Q3", "FY", "Q4"]);
    const revenue = await candidates("revenue");
    const fourth = revenue.filter((candidate) => candidate.period.fiscal_period === "Q4");
    assert.deepEqual(fourth.map((candidate) => [candidate.value_text, candidate.precision?.precision_class, candidate.precision?.raw_token, candidate.context?.disclosure_relation]), [
      ["130", "derived_from_source_tokens", "130", "original"],
      ["170", "derived_from_source_tokens", "170", "original"],
    ]);
    assert.deepEqual(terms(fourth[1]), [
      "+ fiscal_year FY FY2024 2024-01-01..2024-12-31 620 10-K filed 2025-02-15",
      "- quarter Q1 FY2024 2024-01-01..2024-03-31 140 10-Q filed 2024-05-01",
      "- quarter Q2 FY2024 2024-04-01..2024-06-30 150 10-Q filed 2024-08-01",
      "- quarter Q3 FY2024 2024-07-01..2024-09-30 160 10-Q filed 2024-11-01",
    ]);
    const own = fourth[1]!.precision!.derivation!.terms[0]!;
    assert.equal(own.source.source_id, fourth[1]!.source_id, "the 10-K's year is the Q4 fact's own input");
    assert.match(own.source.locator, /^sec_edgar:companyfacts:CIK0001234567#Revenues\|USD\|0001234567-24-000004\|2024-01-01\.\.2024-12-31$/u);
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((offset) => landed(selectInput(latestQuarter("revenue", offset), revenue, POLICY))), [
      "Q4 FY2024 170",
      "Q3 FY2024 160",
      "Q2 FY2024 150",
      "Q1 FY2024 140",
      "Q4 FY2023 130",
      "Q3 FY2023 120",
      "Q2 FY2023 110",
      "Q1 FY2023 100",
    ]);
    const eps = await candidates("eps_diluted");
    assert.deepEqual([0, 1].map((offset) => landed(selectInput(latestQuarter("eps_diluted", offset), eps, POLICY))), [
      "gap missing_input",
      "Q3 FY2024 0.16",
    ], "no EPS Q4 is derived, and the FY2024 10-K still reports the fourth quarter");
  });

  await t.test("a cash-flow quarter certifies from the year-to-date values it is derived from (#481)", async () => {
    const cash = await candidates("operating_cash_flow");
    assert.deepEqual([named("operating_cash_flow", 2024, "Q1"), named("operating_cash_flow", 2024, "Q2"), named("operating_cash_flow", 2024, "Q3"), named("operating_cash_flow", 2024, "Q4")]
      .map((node) => landed(selectInput(node, cash, POLICY))), ["Q1 FY2024 40", "Q2 FY2024 45", "Q3 FY2024 50", "Q4 FY2024 55"]);
    assert.deepEqual(terms(cash.find((candidate) => candidate.period.fiscal_year === 2024 && candidate.period.fiscal_period === "Q3")), [
      "+ year_to_date Q3 FY2024 2024-01-01..2024-09-30 135 10-Q filed 2024-11-01",
      "- year_to_date Q2 FY2024 2024-01-01..2024-06-30 85 10-Q filed 2024-08-01",
    ]);
  });

  await t.test("after the next Q1, one quarter back is the prior year's Q4 and four back is the prior Q1", async () => {
    await ingest(2025, ["Q1"]);
    const revenue = await candidates("revenue");
    assert.deepEqual([0, 1, 4].map((offset) => landed(selectInput(latestQuarter("revenue", offset), revenue, POLICY))), [
      "Q1 FY2025 180",
      "Q4 FY2024 170",
      "Q1 FY2024 140",
    ]);
  });

  await t.test("the Q1 10-Q's balance, stored as FY2025 without a context, leaves FY2024 the latest fiscal year", async () => {
    const latestYear = (metric: string): ReportedMetricNode => ({ ...latestQuarter(metric, 0), period: { kind: "latest", period_type: "annual", offset: 0 } });
    const slots = [
      { node: latestYear("total_assets"), candidates: await candidates("total_assets") },
      { node: latestYear("revenue"), candidates: await candidates("revenue") },
    ];
    assert.ok(slots[0]!.candidates.some((candidate) => candidate.period.fiscal_year === 2025 && candidate.context === null));
    const periods = sharedLatestPeriods(slots, POLICY);
    assert.deepEqual(slots.map(({ node, candidates }) => landed(selectInput(node, candidates, POLICY, { truncated: false }, periods.get(node.node_id)!))), [
      "FY2024 1100",
      "FY2024 620",
    ]);
  });

  await t.test("a margin's numerator and denominator share the latest quarter", async () => {
    const slots = [
      { node: latestQuarter("net_income", 1), candidates: await candidates("net_income") },
      { node: latestQuarter("revenue", 1), candidates: await candidates("revenue") },
      { node: latestQuarter("net_income", 0), candidates: await candidates("net_income") },
      { node: latestQuarter("revenue", 0), candidates: await candidates("revenue") },
    ];
    const periods = sharedLatestPeriods(slots, POLICY);
    assert.deepEqual(slots.map(({ node, candidates }) => landed(selectInput(node, candidates, POLICY, { truncated: false }, periods.get(node.node_id)!))), [
      "Q4 FY2024 17",
      "Q4 FY2024 170",
      "Q1 FY2025 18",
      "Q1 FY2025 180",
    ]);
  });

  await t.test("a Q4 derived from an input without its lossless token is stored unproven, so it is a gap (#481)", async () => {
    const issuer = await secIssuer(db, "46900000-0000-4000-8000-000000000002", 2234567, { untokened: "Q2 FY2024" });
    await issuer.ingest(2024, ["Q1", "Q2", "Q3", "FY", "Q4"]);
    const revenue = await issuer.candidates("revenue");
    assert.deepEqual(revenue.filter((candidate) => candidate.period.fiscal_period === "Q4").map((candidate) => [candidate.value_text, candidate.precision]), [["170", null]]);
    assert.equal(landed(selectInput(named("revenue", 2024, "Q4"), revenue, POLICY)), "gap precision_unverified");
  });

  await t.test("a Q4 whose Q3 10-Q was filed after the 10-K is stored unproven, so it is a gap (#481)", async () => {
    const issuer = await secIssuer(db, "46900000-0000-4000-8000-000000000003", 3234567, { filed: { "Q3 FY2024": "2025-03-01" } });
    await issuer.ingest(2024, ["Q1", "Q2", "Q3", "FY", "Q4"]);
    const revenue = await issuer.candidates("revenue");
    assert.deepEqual(revenue.filter((candidate) => candidate.period.fiscal_period === "Q4").map((candidate) => [candidate.value_text, candidate.precision, candidate.context]), [["170", null, null]]);
    assert.equal(landed(selectInput(named("revenue", 2024, "Q4"), revenue, POLICY)), "gap precision_unverified");
    assert.equal(landed(selectInput(named("revenue", 2024, "Q3"), revenue, POLICY)), "Q3 FY2024 160", "the late 10-Q's own quarter is unaffected");
  });

  await t.test("rerunning the SEC backfill proves a Q4 stored before #481 in place, and replaces one its derivation contradicts (#481)", async () => {
    const issuer = await secIssuer(db, "46900000-0000-4000-8000-000000000005", 5234567);
    await issuer.ingest(2024, ["Q1", "Q2", "Q3", "FY", "Q4"]);
    const fourth = async (metric: string) => (await issuer.candidates(metric)).filter((candidate) => candidate.period.fiscal_period === "Q4");
    const [revenue] = await fourth("revenue");
    const [netIncome] = await fourth("net_income");
    await db.query(`delete from fact_precision_attestations where fact_id = any($1::uuid[])`, [[revenue!.fact_id, netIncome!.fact_id]]);
    await db.query(`delete from fact_financial_contexts where fact_id = any($1::uuid[])`, [[revenue!.fact_id, netIncome!.fact_id]]);
    await db.query(`update facts set value_num = 17.5 where fact_id = $1`, [netIncome!.fact_id]);
    assert.deepEqual((await fourth("revenue")).map((candidate) => [candidate.fact_id, candidate.precision, candidate.context]), [[revenue!.fact_id, null, null]]);

    await issuer.backfill();
    assert.deepEqual((await fourth("revenue")).map((candidate) => [candidate.fact_id, candidate.value_text, candidate.precision?.precision_class, candidate.context?.disclosure_relation]),
      [[revenue!.fact_id, "170", "derived_from_source_tokens", "original"]]);
    const replaced = await fourth("net_income");
    assert.deepEqual(replaced.map((candidate) => [candidate.fact_id === netIncome!.fact_id, candidate.value_text, candidate.precision?.precision_class]), [[false, "17", "derived_from_source_tokens"]]);
    assert.deepEqual((await db.query(`select invalidated_at is not null as invalidated, superseded_by::text from facts where fact_id = $1`, [netIncome!.fact_id])).rows,
      [{ invalidated: true, superseded_by: replaced[0]!.fact_id }]);
  });

  await t.test("before the 10-K is public its Q4 is not reported, so the latest quarter is Q3 (#481)", async () => {
    const issuer = await secIssuer(db, "46900000-0000-4000-8000-000000000004", 4234567);
    await issuer.ingest(2024, ["Q1", "Q2", "Q3"], "2024-11-15T15:00:00.000Z");
    await issuer.ingest(2024, ["FY", "Q4"], "2025-02-20T15:00:00.000Z");
    const revenue = await issuer.candidates("revenue");
    const at = (cutoff: string) => [0, 1].map((offset) => landed(selectInput(latestQuarter("revenue", offset), revenue, { ...POLICY, knowledge_cutoff: cutoff })));
    assert.deepEqual(at("2025-01-01T00:00:00.000Z"), ["Q3 FY2024 160", "Q2 FY2024 150"]);
    assert.deepEqual(at("2025-03-01T00:00:00.000Z"), ["Q4 FY2024 170", "Q3 FY2024 160"]);
  });
});
