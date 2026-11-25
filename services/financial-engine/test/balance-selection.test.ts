// Net cash and total debt leave out a balance only when no filing reported it
// for that period (ADR 0006, #602). A candidate selection filters out, such as
// a restatement under as_reported or a fact not yet public at the cutoff,
// blocks the figure: leaving it out would understate its side. So does a
// balance an earlier 10-K reported: the store may have missed this year's
// line (#792).

import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateBoundPlan,
  nodeLineageHashes,
  unitPublication,
  type FinancialPlan,
  type LocalId,
  type ReportedMetricNode,
  type SlotBinding,
} from "../../financial-core/src/index.ts";
import { aapl, balancePlan, FY2026, gapOf, publish, valueOf } from "../../financial-core/test/balance-fixtures.ts";
import { selectPlanInputs } from "../src/bind-inputs.ts";
import type { FinancialEvidencePort, InputCandidate } from "../src/ports.ts";
import { selectInput, type SelectionPolicy } from "../src/select-inputs.ts";
import { authorityFor } from "./db-fixtures.ts";

const HASH = "a".repeat(64);
const POLICY: SelectionPolicy = { knowledge_cutoff: "2026-11-09T23:59:59.999-05:00", reporting_basis: "as_reported", max_age_days: null, allowed_source_classes: ["sec_filing"] };
const balanceNode = (metric: string): ReportedMetricNode => ({
  node_id: metric, operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: metric, period: FY2026,
});
const COMMERCIAL_PAPER = balanceNode("commercial_paper");

type Spec = {
  relation?: "original" | "economic_restatement" | "unverified_restatement";
  fiscalYear?: number;
  publishedLocalDate?: string;
  metric?: string;
  value?: string;
  end?: string;
  /** Ingestion records a balance's context only from a 10-K. */
  form?: "10-K" | "10-Q";
  id?: string;
};

function commercialPaper({
  relation = "original", fiscalYear = 2026, publishedLocalDate = "2026-11-03", metric = "commercial_paper", value = "1997000000", end = `${fiscalYear}-09-26`, form = "10-K",
  id = `00000000-0000-4000-8000-${relation === "original" ? "000000000001" : "000000000002"}`,
}: Spec = {}): InputCandidate {
  return {
    fact_id: id,
    source_id: "11111111-1111-4111-8111-111111111111",
    source_class: "sec_filing",
    source_version_hash: HASH,
    metric_key: metric,
    period: { start: end, end, fiscal_year: fiscalYear, fiscal_period: "FY" },
    value_text: value,
    scale_text: "1",
    unit: { kind: "currency", currency: "USD" },
    method: relation === "original" ? "reported" : "restated",
    verification_status: "authoritative",
    coverage_level: "full",
    reported_at: `${publishedLocalDate}T00:00:00.000Z`,
    observed_at: "2026-11-09T15:00:00.000Z",
    supersedes: relation === "original" ? null : "00000000-0000-4000-8000-0000000000ff",
    superseded_by: null,
    context: form === "10-Q" ? null : {
      period_type: "instant",
      dimension_scope: "consolidated",
      dimension_members: [],
      adjustment_basis: "unadjusted",
      share_basis: "not_applicable",
      fiscal_calendar_version: "fiscal-calendar.v1",
      disclosure_relation: relation,
    },
    precision: { precision_attestation_id: `bbbbbbbb${id.slice(8)}`, precision_class: "source_token_preserved", raw_token: value, token_proof_hash: HASH, source_locator: "loc", derivation: null },
    publication: [{
      attestation_id: `aaaaaaaa${id.slice(8)}`,
      timing: { available_not_before: null, available_no_later_than: `${publishedLocalDate}T00:00:00-05:00`, timing_precision: "date", source_timezone: "America/New_York" },
    }],
  };
}

/** Commercial paper's selection from these candidates, and the two figures with every other balance AAPL's. */
function figures(candidates: InputCandidate[]) {
  const selection = selectInput(COMMERCIAL_PAPER, candidates, POLICY);
  assert.equal(selection.status, "gap", "commercial paper is never bound here");
  const reason = selection.status === "gap" ? selection.reason_code : "missing_input";
  const results = publish(aapl({ commercial_paper: reason }));
  const outcome = (result: (typeof results)[string]) => result?.payload.kind === "value" ? valueOf(result) : gapOf(result);
  return { reason, net_cash: outcome(results.net_cash), total_debt: outcome(results.total_debt) };
}

const BLOCKED = ["blocked_dependency", "blocked_by_dependency"];
const MISSING = ["missing", "missing_input"];

test("the candidate an as_reported 10-K figure would bind is selectable", () => {
  const selection = selectInput(COMMERCIAL_PAPER, [commercialPaper()], POLICY);
  assert.deepEqual(selection.status === "selected" && selection.input.candidate.fact_id, "00000000-0000-4000-8000-000000000001");
});

test("a balance reported only as a restatement blocks both figures under as_reported", () => {
  for (const relation of ["economic_restatement", "unverified_restatement"] as const) {
    assert.deepEqual(figures([commercialPaper({ relation })]), { reason: "ineligible_input", net_cash: BLOCKED, total_debt: BLOCKED }, relation);
  }
});

test("a balance no filing made public by the cutoff blocks both figures", () => {
  assert.deepEqual(figures([commercialPaper({ publishedLocalDate: "2026-12-01" })]), { reason: "ineligible_input", net_cash: BLOCKED, total_debt: BLOCKED });
});

let facts = 0;

/** One stored balance, by default a 10-K's public on its filing day; each has its own fact id. */
function stored(metric: string, value: string, fiscalYear: number, end: string, spec: Spec = {}): InputCandidate {
  facts += 1;
  return commercialPaper({ metric, value, fiscalYear, end, id: `00000000-0000-4000-8000-${String(facts).padStart(12, "0")}`, ...spec });
}

/** Rows for one balance sheet: each key's value at that fiscal year's end. */
function balanceSheet(fiscalYear: number, end: string, values: Record<string, string>, spec: Spec = {}): InputCandidate[] {
  return Object.entries(values).map(([metric, value]) => stored(metric, value, fiscalYear, end, spec));
}

/** An evidence port over these rows, which reads like the store: one fiscal period when asked for one, else every row of the metric. */
function storeOf(rows: ReadonlyArray<InputCandidate>): FinancialEvidencePort {
  return {
    listInputCandidates: async (request) => ({
      status: "ok",
      truncated: false,
      candidates: rows.filter((row) => row.metric_key === request.metric_key
        && (request.fiscal_year === null || row.period.fiscal_year === request.fiscal_year)
        && (request.fiscal_period === null || row.period.fiscal_period === request.fiscal_period)),
    }),
    readSplitHistory: async () => assert.fail("an unadjusted balance reads no split history"),
    readPriceObservations: async () => assert.fail("a balance plan reads no price"),
  };
}

/** The balance plan for one fiscal year, at a cutoff. */
function planFor(fiscalYear: number, cutoff: string): FinancialPlan {
  const validated = balancePlan((operations) => operations.map((node) =>
    node.operation === "reported_metric" ? { ...node, period: { kind: "fiscal_period", fiscal_year: fiscalYear, fiscal_period: "FY" } } : node));
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return { ...validated.value, time: { ...validated.value.time, knowledge_cutoff: cutoff } };
}

/** How the binder binds a balance plan for `fiscalYear` over `rows`: each slot's gap reason, and the two figures. */
async function bind(rows: ReadonlyArray<InputCandidate>, fiscalYear = 2026, cutoff = POLICY.knowledge_cutoff) {
  const plan = planFor(fiscalYear, cutoff);
  const outcomes = await selectPlanInputs({
    client: { query: async () => ({ rows: [] }) },
    plan,
    authority: authorityFor(),
    evidence: storeOf(rows),
    allowed_source_classes: ["sec_filing"],
  });
  const bindings = new Map<LocalId, SlotBinding>(outcomes.map(({ binding }) => [binding.slot, binding]));
  const evaluation = evaluateBoundPlan(plan, bindings);
  const results = unitPublication(plan, evaluation, nodeLineageHashes(plan, evaluation, bindings), "balance").results;
  const figure = (outputId: string) => {
    const result = results.find((entry) => entry.output_id === outputId);
    return result?.payload.kind === "value" ? valueOf(result) : gapOf(result);
  };
  const gaps = Object.fromEntries(outcomes.flatMap(({ binding }) => binding.status === "gap" ? [[binding.slot, binding.reason_code]] : []));
  return { gaps, net_cash: figure("net_cash"), total_debt: figure("total_debt") };
}

/** Each named slot's gap reason, then the two figures. */
async function figuresOf(slots: ReadonlyArray<string>, ...args: Parameters<typeof bind>) {
  const { gaps, net_cash, total_debt } = await bind(...args);
  return { ...Object.fromEntries(slots.map((slot) => [slot, gaps[slot] ?? "bound"])), net_cash, total_debt };
}

// AAPL's FY2026 10-K (2026-09-26) without commercial paper: 80.111B of debt
// less 1.997B, and 56.824B of net cash plus it.
const AAPL_WITHOUT_PAPER = balanceSheet(2026, "2026-09-26", {
  cash_and_equivalents: "36305000000",
  marketable_securities_current: "20417000000",
  marketable_securities_noncurrent: "80213000000",
  long_term_debt_current: "9906000000",
  long_term_debt_noncurrent: "68208000000",
});

test("a balance no earlier 10-K public by the cutoff reported is left out of both figures", async () => {
  const absent = { commercial_paper: "missing_input", net_cash: "58821000000", total_debt: "78114000000" };
  const paper = (spec: Spec & { fiscalYear: number; end: string }) => stored("commercial_paper", "1997000000", spec.fiscalYear, spec.end, spec);
  assert.deepEqual(await figuresOf(["commercial_paper"], AAPL_WITHOUT_PAPER), absent, "no row at all");
  // A 10-Q's balance is stored labelled FY of its fiscal year, without a context.
  assert.deepEqual(await figuresOf(["commercial_paper"], [...AAPL_WITHOUT_PAPER, paper({ fiscalYear: 2025, end: "2025-09-27", form: "10-Q" })]), absent, "a 10-Q's");
  // The FY2025 10-K's balance, from a source first proven public after the cutoff: a run as of then cannot know it.
  assert.deepEqual(
    await figuresOf(["commercial_paper"], [...AAPL_WITHOUT_PAPER, paper({ fiscalYear: 2025, end: "2025-09-27", publishedLocalDate: "2026-12-01" })]),
    absent,
    "a 10-K public after the cutoff",
  );
  // A later 10-K's balance sheet is not an earlier one.
  assert.deepEqual(
    await figuresOf(["commercial_paper"], [...AAPL_WITHOUT_PAPER, paper({ fiscalYear: 2027, end: "2027-09-25", publishedLocalDate: "2027-11-01" })], 2026, "2027-11-30T23:59:59.999-05:00"),
    absent,
    "a later 10-K's",
  );
});

test("a balance the 10-K for the year before reported, with none for its fiscal year, blocks both figures (#792)", async () => {
  assert.deepEqual(
    await figuresOf(["commercial_paper"], [...AAPL_WITHOUT_PAPER, stored("commercial_paper", "1997000000", 2025, "2025-09-27")]),
    { commercial_paper: "absence_unverified", net_cash: BLOCKED, total_debt: BLOCKED },
  );
});

// NVDA's FY2026 10-K (0001045810-26-000021) tags its 51.951B of marketable
// securities nvda:MarketableSecuritiesAndEquitySecuritiesFVNI, a company
// concept SEC companyfacts does not carry, so the store holds none. Its FY2025
// 10-K tagged 34.621B MarketableSecuritiesCurrent and zero commercial paper,
// and its FY2026 10-K tags no commercial paper.
const NVDA_FY2025 = balanceSheet(2025, "2025-01-26", {
  cash_and_equivalents: "8589000000",
  marketable_securities_current: "34621000000",
  commercial_paper: "0",
  long_term_debt_current: "0",
  long_term_debt_noncurrent: "8463000000",
}, { publishedLocalDate: "2025-02-26" });
const NVDA_FY2026 = balanceSheet(2026, "2026-01-25", {
  cash_and_equivalents: "10605000000",
  long_term_debt_current: "999000000",
  long_term_debt_noncurrent: "7469000000",
}, { publishedLocalDate: "2026-02-25" });
const NVDA_LINES = ["marketable_securities_current", "commercial_paper"];

test("NVDA FY2026: lines its FY2025 10-K reported block both figures, not a net cash of 2.137B (#792)", async () => {
  assert.deepEqual(await figuresOf(NVDA_LINES, [...NVDA_FY2025, ...NVDA_FY2026]), {
    marketable_securities_current: "absence_unverified", commercial_paper: "absence_unverified", net_cash: BLOCKED, total_debt: BLOCKED,
  });
});

test("NVDA FY2027: lines absent from its FY2026 and FY2027 10-Ks still block both figures, the zero commercial paper too (#792)", async () => {
  // A hypothetical FY2027 10-K (2027-01-31) that, like FY2026's, tags its securities with the company concept and no commercial paper.
  const fy2027 = balanceSheet(2027, "2027-01-31", {
    cash_and_equivalents: "10605000000",
    long_term_debt_current: "999000000",
    long_term_debt_noncurrent: "7469000000",
  }, { publishedLocalDate: "2027-02-24" });
  assert.deepEqual(await figuresOf(NVDA_LINES, [...NVDA_FY2025, ...NVDA_FY2026, ...fy2027], 2027, "2027-03-31T23:59:59.999-04:00"), {
    marketable_securities_current: "absence_unverified", commercial_paper: "absence_unverified", net_cash: BLOCKED, total_debt: BLOCKED,
  });
});

test("Coca-Cola FY2025: debt lines last reported two and three years back block both figures, not total debt of 1.495B (#792)", async () => {
  const rows = [
    ...balanceSheet(2022, "2022-12-31", { short_term_borrowings: "2373000000" }),
    ...balanceSheet(2023, "2023-12-31", { long_term_debt_current: "1960000000", long_term_debt_noncurrent: "35547000000" }),
    ...balanceSheet(2024, "2024-12-31", { cash_and_equivalents: "10828000000", commercial_paper: "1139000000" }),
    ...balanceSheet(2025, "2025-12-31", { cash_and_equivalents: "10270000000", commercial_paper: "1495000000" }, { publishedLocalDate: "2026-02-20" }),
  ];
  assert.deepEqual(await figuresOf(["long_term_debt_current", "long_term_debt_noncurrent", "short_term_borrowings"], rows, 2025), {
    long_term_debt_current: "absence_unverified",
    long_term_debt_noncurrent: "absence_unverified",
    short_term_borrowings: "absence_unverified",
    net_cash: BLOCKED,
    total_debt: BLOCKED,
  });
});

test("after a fiscal-year change skips a label, the 10-K before still blocks a line it reported (#792)", async () => {
  // The 10-K before this FY2026 one is labelled FY2024: no 10-K is labelled FY2025.
  const rows = [...AAPL_WITHOUT_PAPER, stored("commercial_paper", "1997000000", 2024, "2025-03-29", { publishedLocalDate: "2025-05-15" })];
  assert.deepEqual(await figuresOf(["commercial_paper"], rows), { commercial_paper: "absence_unverified", net_cash: BLOCKED, total_debt: BLOCKED });
});

test("HON: a 10-K companyfacts labels another fiscal year still blocks a line it reported (#792)", async () => {
  // HON's FY2021 10-K (2021-12-31) is labelled fiscal 2020. Were its FY2022
  // short-term investments (0.483B) lost, net cash would read 6.910B.
  const rows = [
    ...balanceSheet(2020, "2021-12-31", { cash_and_equivalents: "10959000000", short_term_investments: "564000000", short_term_borrowings: "3542000000" }),
    ...balanceSheet(2022, "2022-12-31", { cash_and_equivalents: "9627000000", short_term_borrowings: "2717000000" }, { publishedLocalDate: "2023-02-10" }),
  ];
  assert.deepEqual(await figuresOf(["short_term_investments"], rows, 2022), { short_term_investments: "absence_unverified", net_cash: BLOCKED, total_debt: "2717000000" });
  // The same line filed at this balance sheet's own date under another label is still the line.
  const sameDate = [...AAPL_WITHOUT_PAPER, stored("commercial_paper", "1997000000", 2024, "2026-09-26")];
  assert.deepEqual(await figuresOf(["commercial_paper"], sameDate), { commercial_paper: "absence_unverified", net_cash: BLOCKED, total_debt: BLOCKED });
});

test("a line that moved to the key its definition may count as the same line is explained, not unverified (#792)", async () => {
  // AMD's FY2019 10-K tagged 37M of marketable securities; FY2020's tags 695M of short-term investments instead.
  const amd = [
    ...balanceSheet(2019, "2019-12-28", { cash_and_equivalents: "1466000000", marketable_securities_current: "37000000", long_term_debt_noncurrent: "486000000" }),
    ...balanceSheet(2020, "2020-12-26", { cash_and_equivalents: "1595000000", short_term_investments: "695000000", long_term_debt_noncurrent: "330000000" }, { publishedLocalDate: "2021-01-29" }),
  ];
  assert.deepEqual(await figuresOf(["marketable_securities_current"], amd, 2020), { marketable_securities_current: "missing_input", net_cash: "1960000000", total_debt: "330000000" });
  // C3.ai's FY2023 10-K tagged short-term investments; FY2024's tags marketable securities. It reports no debt, so no figure forms either way.
  const c3 = [
    ...balanceSheet(2023, "2023-04-30", { cash_and_equivalents: "284829000", short_term_investments: "446155000" }),
    ...balanceSheet(2024, "2024-04-30", { cash_and_equivalents: "167146000", marketable_securities_current: "583221000", marketable_securities_noncurrent: "0" }, { publishedLocalDate: "2024-06-14" }),
  ];
  assert.deepEqual(await figuresOf(["short_term_investments"], c3, 2024), { short_term_investments: "missing_input", net_cash: MISSING, total_debt: MISSING });
});

test("Microsoft FY2026: lines last reported as zero, the year before or eight years back, still block both figures (#792)", async () => {
  const rows = [
    ...balanceSheet(2018, "2018-06-30", { short_term_borrowings: "0" }),
    ...balanceSheet(2025, "2025-06-30", { commercial_paper: "0" }),
    ...balanceSheet(2026, "2026-06-30", {
      cash_and_equivalents: "20935000000",
      short_term_investments: "55908000000",
      long_term_debt_current: "9227000000",
      long_term_debt_noncurrent: "31067000000",
    }, { publishedLocalDate: "2026-07-29" }),
  ];
  assert.deepEqual(await figuresOf(["commercial_paper", "short_term_borrowings"], rows), {
    commercial_paper: "absence_unverified", short_term_borrowings: "absence_unverified", net_cash: BLOCKED, total_debt: BLOCKED,
  });
});
