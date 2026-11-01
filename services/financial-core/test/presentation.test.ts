import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialPlanV1, PeriodSelector } from "../src/contracts.ts";
import { parseDerivedDecimalText } from "../src/exact-decimal.ts";
import { fixed, presentationHash, presentFinancialUnit, type BoundPeriod, type CommittedResult, type FinancialAnswerContent } from "../src/presentation.ts";
import { change, mutable, overviewComparisonPlan, planFixture, quarterBack, reportedAt } from "./fixtures.ts";

const HASH = "a".repeat(64);
const NAMES = { a: "Alpha Corp", b: "Beta Inc" };

function committed(output_id: string, node_id: string, payload: unknown, disposition: CommittedResult["disposition"] = "computed"): CommittedResult {
  return { result_id: `r-${output_id}`, output_id, node_id, disposition, payload, result_hash: HASH };
}

function comparisonResults(overrides: Partial<Record<string, CommittedResult>> = {}): CommittedResult[] {
  const defaults: Record<string, CommittedResult> = {
    out_a_rev: committed("out_a_rev", "a_rev", { kind: "value", value: "1234567.891", unit: { kind: "currency", currency: "USD" }, exact: true, rounding: null }),
    out_a_gm: committed("out_a_gm", "a_gm", { kind: "value", value: "0.41235", unit: { kind: "ratio" }, exact: true, rounding: null }),
    out_b_gm: committed("out_b_gm", "b_gm", { kind: "value", value: "0.38", unit: { kind: "ratio" }, exact: true, rounding: null }),
    out_check: committed("out_check", "a_gm_check", { kind: "predicate", predicate: "threshold", comparison: "gte", outcome: true }),
    out_rank: committed("out_rank", "gm_rank", {
      kind: "ranking", direction: "highest", population: { requested: 2, evaluated: 2 }, complete: true,
      ranks: [{ node_id: "a_gm", rank: 1 }, { node_id: "b_gm", rank: 2 }], extreme: ["a_gm"],
    }),
  };
  return Object.entries({ ...defaults, ...overrides }).map(([, value]) => value!);
}

function present(plan: FinancialPlanV1 = planFixture(), results = comparisonResults(), names: Record<string, string> = NAMES, periods: Record<string, BoundPeriod> = {}): FinancialAnswerContent {
  return presentFinancialUnit({ plan, run_id: "run-1", unit_id: "section", results, subject_names: names, periods: new Map(Object.entries(periods)) });
}

function result(content: FinancialAnswerContent, outputId: string) {
  return content.results.find((candidate) => candidate.output_id === outputId)!;
}

function resultText(content: FinancialAnswerContent, outputId: string): string {
  return result(content, outputId).presented.text;
}

/** The subject, measure, and period label texts of a result. */
function labelTexts(content: FinancialAnswerContent, outputId: string): [string | null, string, string] {
  const { subject_label_id, measure_label_id, period_label_id } = result(content, outputId);
  return [subject_label_id && content.labels[subject_label_id]!.text, content.labels[measure_label_id]!.text, content.labels[period_label_id]!.text];
}

function decimal(text: string) {
  const parsed = parseDerivedDecimalText(text);
  assert.ok(parsed.ok);
  return parsed.value;
}

test("fixed rounds half-even with thousands separators and no negative zero", () => {
  assert.equal(fixed(decimal("1234567.891"), 2), "1,234,567.89");
  assert.equal(fixed(decimal("0.125"), 2), "0.12");
  assert.equal(fixed(decimal("0.135"), 2), "0.14");
  assert.equal(fixed(decimal("-2.5"), 0), "-2");
  assert.equal(fixed(decimal("-0.001"), 2), "0.00");
  assert.equal(fixed(decimal("7"), 2), "7.00");
  assert.equal(fixed(decimal("-1234.5"), 0), "-1,234");
});

test("a two-company plan presents labels, formatted exact values, a table, a predicate, and a ranking", () => {
  const content = present();
  assert.equal(content.presentation_version, "financial-presentation.v2");
  assert.equal(content.template_version, "financial-answer.v1");
  assert.deepEqual(content.coverage, { state: "complete", requested: 5, verified: 5 });
  assert.deepEqual(labelTexts(content, "out_a_gm"), ["Alpha Corp", "Gross margin (gross profit / revenue)", "FY2023"], "the denominator is visible in the label");
  assert.equal(result(content, "out_a_gm").measure_label_id, result(content, "out_b_gm").measure_label_id, "one measure, one label, across subjects");
  assert.equal(result(content, "out_rank").subject_label_id, null, "a ranking spans subjects");

  const revenue = content.results.find((result) => result.output_id === "out_a_rev")!;
  assert.deepEqual(revenue.presented, {
    kind: "value", text: "USD 1,234,567.89", full_text: "USD 1234567.891", value: "1234567.891", unit: { kind: "currency", currency: "USD" }, exact: true,
  });
  assert.deepEqual(labelTexts(content, "out_a_rev"), ["Alpha Corp", "Revenue", "FY2023"]);
  assert.equal(revenue.disposition, "verified", "a computed result presents as verified");
  assert.equal(resultText(content, "out_a_gm"), "41.24%", "ratios are percentages rounded half-even");
  const margin = content.results.find((result) => result.output_id === "out_a_gm")!.presented;
  assert.ok(margin.kind === "value" && margin.full_text === "41.235%", "the full canonical value travels with the rounded label");
  assert.equal(resultText(content, "out_check"), "Alpha Corp — Gross margin (gross profit / revenue), FY2023, at or above 40.00%: yes");
  assert.equal(resultText(content, "out_rank"), "Highest: Alpha Corp");

  const table = content.presentations.find((presentation) => presentation.kind === "table");
  assert.ok(table && table.kind === "table");
  assert.deepEqual(table.rows.map((row) => row.subject_label_id), ["subject:a", "subject:b"]);
  const gmColumn = table.columns.findIndex((column) => column.measure_label_id === result(content, "out_a_gm").measure_label_id);
  assert.deepEqual(table.rows.map((row) => row.cells[gmColumn]), ["r-out_a_gm", "r-out_b_gm"]);
  assert.deepEqual(table.ascending[table.columns[gmColumn]!.column_id], [1, 0], "Beta's 38% sorts before Alpha's 41.235%");
  const revenueColumn = table.columns.findIndex((column) => column.measure_label_id === result(content, "out_a_rev").measure_label_id);
  assert.deepEqual(table.rows.map((row) => row.cells[revenueColumn]), ["r-out_a_rev", null], "a missing cell is explicit, not invented");
  assert.deepEqual(table.ascending[table.columns[revenueColumn]!.column_id], [0, 1], "rows without a value sort last");
  assert.deepEqual(
    content.presentations.filter((presentation) => presentation.kind !== "table").map((presentation) => [presentation.kind, "result_id" in presentation ? presentation.result_id : null]),
    [["predicate", "r-out_check"], ["predicate", "r-out_rank"]],
  );
});

test("table sorting compares exact decimals, not display text or floats", () => {
  const results = comparisonResults({
    out_a_gm: committed("out_a_gm", "a_gm", { kind: "value", value: "0.100000000000000000001", unit: { kind: "ratio" }, exact: true, rounding: null }),
    out_b_gm: committed("out_b_gm", "b_gm", { kind: "value", value: "0.1", unit: { kind: "ratio" }, exact: true, rounding: null }),
  });
  const content = present(planFixture(), results);
  const table = content.presentations.find((presentation) => presentation.kind === "table");
  assert.ok(table && table.kind === "table");
  const gmColumn = table.columns.findIndex((column) => column.measure_label_id === result(content, "out_a_gm").measure_label_id);
  assert.equal(resultText(content, "out_a_gm"), resultText(content, "out_b_gm"), "the display labels tie");
  assert.deepEqual(table.ascending[table.columns[gmColumn]!.column_id], [1, 0], "the exact values do not");
});

test("an incomplete ranking can order its members but never names a leader", () => {
  const results = comparisonResults({
    out_b_gm: committed("out_b_gm", "b_gm", { kind: "gap", reason_code: "missing_input", explanation: "A required input or calculation is unavailable." }, "missing"),
    out_rank: committed("out_rank", "gm_rank", {
      kind: "ranking", direction: "highest", population: { requested: 2, evaluated: 1 }, complete: false,
      ranks: [{ node_id: "a_gm", rank: 1 }], extreme: null,
    }),
  });
  const content = present(planFixture(), results);
  const ranking = content.results.find((result) => result.output_id === "out_rank")!.presented;
  assert.ok(ranking.kind === "ranking");
  assert.equal(ranking.complete, false);
  assert.equal(ranking.leader_label_ids, null);
  assert.deepEqual(ranking.order, [{ subject_label_id: "subject:a", rank: 1 }]);
  assert.equal(ranking.text, "Ranked 1 of 2 companies; no overall highest can be stated for an incomplete group");
  assert.doesNotMatch(ranking.text, /Alpha/u);

  const gap = content.results.find((result) => result.output_id === "out_b_gm")!;
  assert.equal(gap.disposition, "missing");
  assert.deepEqual(gap.presented, { kind: "gap", text: "A required input or calculation is unavailable.", reason_code: "missing_input" });
  assert.deepEqual(content.coverage, { state: "partial", requested: 5, verified: 4 });
});

test("one subject with a measure over several periods is a series in operand order", () => {
  const plan = mutable(planFixture()) as FinancialPlanV1;
  plan.subjects = { ...plan.subjects, requested_count: 1, resolved_count: 1, members: [plan.subjects.members[0]!] };
  plan.operations = [
    { node_id: "rev23", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "revenue", period: { kind: "fiscal_period", fiscal_year: 2023, fiscal_period: "FY" } },
    { node_id: "rev22", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "revenue", period: { kind: "fiscal_period", fiscal_year: 2022, fiscal_period: "FY" } },
    { node_id: "growth", operation: "percent_change_positive_base", operation_version: "percent_change_positive_base.v1", current: "rev23", prior: "rev22" },
  ];
  plan.outputs = [
    { output_id: "o22", node_id: "rev22", unit_id: "section" },
    { output_id: "o23", node_id: "rev23", unit_id: "section" },
    { output_id: "og", node_id: "growth", unit_id: "section" },
  ];
  plan.thresholds = [];
  const usd = (value: string) => ({ kind: "value", value, unit: { kind: "currency", currency: "USD" }, exact: true, rounding: null });
  const content = present(plan, [
    committed("o22", "rev22", usd("100")),
    committed("o23", "rev23", usd("125")),
    committed("og", "growth", { kind: "value", value: "25", unit: { kind: "percent" }, exact: true, rounding: null }),
  ], { a: "Alpha Corp" });
  assert.deepEqual(labelTexts(content, "og"), ["Alpha Corp", "Year-over-year percent change in Revenue", "FY2023 vs FY2022"], "current before prior, from operand order");
  assert.deepEqual(content.presentations, [
    { kind: "series", subject_label_id: "subject:a", measure_label_id: result(content, "o22").measure_label_id, points: [
      { period_label_id: result(content, "o22").period_label_id, result_id: "r-o22" },
      { period_label_id: result(content, "o23").period_label_id, result_id: "r-o23" },
    ] },
    { kind: "scalar", result_id: "r-og" },
  ]);
});

function singleSubjectPlan(operations: FinancialPlanV1["operations"], outputs: string[], thresholds: FinancialPlanV1["thresholds"] = []): FinancialPlanV1 {
  const plan = mutable(planFixture()) as FinancialPlanV1;
  plan.subjects = { ...plan.subjects, requested_count: 1, resolved_count: 1, members: [plan.subjects.members[0]!] };
  plan.operations = operations;
  plan.outputs = outputs.map((node_id) => ({ output_id: `o_${node_id}`, node_id, unit_id: "section" }));
  plan.thresholds = thresholds;
  return plan;
}

function comparisonPlan(operations: FinancialPlanV1["operations"], outputs: string[]): FinancialPlanV1 {
  const plan = mutable(planFixture()) as FinancialPlanV1;
  plan.operations = operations;
  plan.outputs = outputs.map((node_id) => ({ output_id: `o_${node_id}`, node_id, unit_id: "section" }));
  plan.thresholds = [];
  return plan;
}

const FY = (fiscal_year: number) => ({ kind: "fiscal_period" as const, fiscal_year, fiscal_period: "FY" as const });
const balance = (node_id: string, metric_key: string, fiscal_year = 2023) =>
  ({ node_id, operation: "reported_metric" as const, operation_version: "reported_metric.v1", subject_slot: "a", metric_key, period: FY(fiscal_year) });
const valueOf = (value: string, unit: unknown) => ({ kind: "value", value, unit, exact: true, rounding: null });

test("a threshold on an approved ratio reads as a multiple, like the ratio's value", () => {
  const plan = singleSubjectPlan(
    [
      balance("tl", "total_liabilities"),
      balance("ta", "total_assets"),
      { node_id: "lta", operation: "ratio", operation_version: "ratio.v1", ratio_key: "liabilities_to_assets", numerator: "tl", denominator: "ta" },
      { node_id: "lta_check", operation: "threshold", operation_version: "threshold.v1", subject: "lta", threshold_id: "max_lta", comparison: "gt" },
    ],
    ["lta", "lta_check"],
    [{ threshold_id: "max_lta", value: "0.5", unit: { kind: "ratio" }, attribution: { kind: "user_request", ref: "chat:turn:1" } }],
  );
  const content = present(plan, [
    committed("o_lta", "lta", valueOf("0.55", { kind: "ratio" })),
    committed("o_lta_check", "lta_check", { kind: "predicate", predicate: "threshold", comparison: "gt", outcome: true }),
  ], { a: "Alpha Corp" });
  assert.equal(resultText(content, "o_lta"), "0.55x");
  assert.equal(resultText(content, "o_lta_check"), "Alpha Corp — Total liabilities / total assets (period-end balance sheet), end of FY2023, above 0.50x: yes");
});

test("a change between two balances names the end of each period", () => {
  const plan = singleSubjectPlan(
    [
      balance("ta23", "total_assets"),
      balance("ta22", "total_assets", 2022),
      { node_id: "ta_change", operation: "absolute_change", operation_version: "absolute_change.v1", current: "ta23", prior: "ta22" },
    ],
    ["ta_change"],
  );
  const content = present(plan, [committed("o_ta_change", "ta_change", valueOf("50", { kind: "currency", currency: "USD" }))], { a: "Alpha Corp" });
  assert.deepEqual(labelTexts(content, "o_ta_change"), ["Alpha Corp", "Year-over-year change in Total assets", "end of FY2023 vs end of FY2022"]);
});

const usdValue = (value: string) => valueOf(value, { kind: "currency", currency: "USD" });
const ratioValue = (value: string) => valueOf(value, { kind: "ratio" });
const percentValue = (value: string) => valueOf(value, { kind: "percent" });
const UNAVAILABLE = { kind: "gap", reason_code: "missing_input", explanation: "A required input or calculation is unavailable." };

const NVDA_LINES = { rev: usdValue("100"), gp: usdValue("75"), oi: usdValue("60"), ni: usdValue("50"), gm: ratioValue("0.75"), om: ratioValue("0.6"), nm: ratioValue("0.5"), qoq: percentValue("10"), yoy: percentValue("50") };
const AMD_LINES = { rev: usdValue("40"), gp: usdValue("20"), oi: usdValue("4"), ni: usdValue("3"), gm: ratioValue("0.5"), om: ratioValue("0.1"), nm: ratioValue("0.075"), qoq: percentValue("5"), yoy: percentValue("30") };
const NVDA_AMD = { a: "NVIDIA Corp", b: "Advanced Micro Devices" };

function linesOf(slot: string, payloads: Record<string, unknown>, dispositions: Record<string, CommittedResult["disposition"]> = {}): CommittedResult[] {
  return Object.entries(payloads).map(([line, payload]) => committed(`out_${slot}_${line}`, `${slot}_${line}`, payload, dispositions[line]));
}

function readTable(content: FinancialAnswerContent) {
  const tables = content.presentations.filter((presentation) => presentation.kind === "table");
  assert.equal(tables.length, 1);
  const [table] = tables;
  assert.ok(table?.kind === "table");
  const text = (id: string | null) => (id === null ? null : content.labels[id]!.text);
  const byId = new Map(content.results.map((entry) => [entry.result_id, entry]));
  return {
    columns: table.columns.map((column) => [text(column.measure_label_id), text(column.period_label_id)]),
    rows: table.rows.map((row) => [text(row.subject_label_id), ...row.cells.map((cell) => {
      const entry = cell === null ? undefined : byId.get(cell);
      return entry ? [entry.output_id, entry.presented.text, text(entry.period_label_id)] : null;
    })]),
  };
}

const NVDA_AMD_COLUMNS = [
  ["Revenue", null],
  ["Gross profit", null],
  ["Operating income", null],
  ["Net income", null],
  ["Gross margin (gross profit / revenue)", null],
  ["Operating margin (operating income / revenue)", null],
  ["Net margin (net income / revenue)", null],
  ["Quarter-over-quarter percent change in Revenue", null],
  ["Year-over-year percent change in Revenue", null],
];
const AMD_ROW = [
  "Advanced Micro Devices",
  ["out_b_rev", "USD 40.00", "Q2 FY2026"],
  ["out_b_gp", "USD 20.00", "Q2 FY2026"],
  ["out_b_oi", "USD 4.00", "Q2 FY2026"],
  ["out_b_ni", "USD 3.00", "Q2 FY2026"],
  ["out_b_gm", "50.00%", "Q2 FY2026"],
  ["out_b_om", "10.00%", "Q2 FY2026"],
  ["out_b_nm", "7.50%", "Q2 FY2026"],
  ["out_b_qoq", "5.00%", "Q2 FY2026 vs Q1 FY2026"],
  ["out_b_yoy", "30.00%", "Q2 FY2026 vs Q2 FY2025"],
];
const NVDA_AMD_TABLE = {
  columns: NVDA_AMD_COLUMNS,
  rows: [
    [
      "NVIDIA Corp",
      ["out_a_rev", "USD 100.00", "Q4 FY2026"],
      ["out_a_gp", "USD 75.00", "Q4 FY2026"],
      ["out_a_oi", "USD 60.00", "Q4 FY2026"],
      ["out_a_ni", "USD 50.00", "Q4 FY2026"],
      ["out_a_gm", "75.00%", "Q4 FY2026"],
      ["out_a_om", "60.00%", "Q4 FY2026"],
      ["out_a_nm", "50.00%", "Q4 FY2026"],
      ["out_a_qoq", "10.00%", "Q4 FY2026 vs Q3 FY2026"],
      ["out_a_yoy", "50.00%", "Q4 FY2026 vs Q4 FY2025"],
    ],
    AMD_ROW,
  ],
};

test("a comparison across fiscal calendars is one column per line, each cell with its own company's period (#474)", () => {
  const plan = overviewComparisonPlan([{ slot: "a", newest: [2026, "Q4"] }, { slot: "b", newest: [2026, "Q2"] }]);
  const content = present(plan, [...linesOf("a", NVDA_LINES), ...linesOf("b", AMD_LINES)], NVDA_AMD);
  assert.deepEqual(content.presentations.map((presentation) => presentation.kind), ["table"], "every result sits in the table");
  assert.deepEqual(readTable(content), NVDA_AMD_TABLE);
});

test("a gap keeps the column of the period its plan requested, never shifting its company's other cells (#474)", () => {
  const plan = overviewComparisonPlan([{ slot: "a", newest: [2026, "Q4"] }, { slot: "b", newest: [2026, "Q2"] }]);
  const blocked = { gm: "blocked_dependency", om: "blocked_dependency", nm: "blocked_dependency", qoq: "blocked_dependency", yoy: "blocked_dependency" } as const;
  const nvda = linesOf("a", { ...NVDA_LINES, rev: UNAVAILABLE, gm: UNAVAILABLE, om: UNAVAILABLE, nm: UNAVAILABLE, qoq: UNAVAILABLE, yoy: UNAVAILABLE }, { rev: "missing", ...blocked });
  const content = present(plan, [...nvda, ...linesOf("b", AMD_LINES)], NVDA_AMD);
  const gap = "A required input or calculation is unavailable.";
  assert.deepEqual(readTable(content), {
    columns: NVDA_AMD_COLUMNS,
    rows: [
      [
        "NVIDIA Corp",
        ["out_a_rev", gap, "Q4 FY2026"],
        ["out_a_gp", "USD 75.00", "Q4 FY2026"],
        ["out_a_oi", "USD 60.00", "Q4 FY2026"],
        ["out_a_ni", "USD 50.00", "Q4 FY2026"],
        ["out_a_gm", gap, "Q4 FY2026"],
        ["out_a_om", gap, "Q4 FY2026"],
        ["out_a_nm", gap, "Q4 FY2026"],
        ["out_a_qoq", gap, "Q4 FY2026 vs Q3 FY2026"],
        ["out_a_yoy", gap, "Q4 FY2026 vs Q4 FY2025"],
      ],
      AMD_ROW,
    ],
  });
});

test("a company whose outputs are listed in another order lands in the same columns", () => {
  const plan = overviewComparisonPlan([{ slot: "a", newest: [2026, "Q4"] }, { slot: "b", newest: [2026, "Q2"], reversed: true }]);
  const content = present(plan, [...linesOf("a", NVDA_LINES), ...linesOf("b", AMD_LINES)], NVDA_AMD);
  assert.deepEqual(readTable(content), NVDA_AMD_TABLE);
});

test("companies on one calendar keep one heading per period, newest first, a gap holding its own year's column", () => {
  const plan = mutable(planFixture()) as FinancialPlanV1;
  plan.operations = (["a", "b"] as const).flatMap((slot) => [2024, 2023].map((year) => reportedAt(`${slot}_rev${year}`, slot, "revenue", FY(year))));
  plan.outputs = ["a_rev2024", "a_rev2023", "b_rev2023", "b_rev2024"].map((node_id) => ({ output_id: `out_${node_id}`, node_id, unit_id: "section" }));
  plan.thresholds = [];
  const names = { a: "Apple Inc.", b: "Microsoft Corp." };
  const results = (msft2024: unknown) => [
    committed("out_a_rev2024", "a_rev2024", usdValue("391035")),
    committed("out_a_rev2023", "a_rev2023", usdValue("383285")),
    committed("out_b_rev2023", "b_rev2023", usdValue("211915")),
    committed("out_b_rev2024", "b_rev2024", msft2024, msft2024 === UNAVAILABLE ? "missing" : "computed"),
  ];
  const apple = ["Apple Inc.", ["out_a_rev2024", "USD 391,035.00", "FY2024"], ["out_a_rev2023", "USD 383,285.00", "FY2023"]];
  assert.deepEqual(readTable(present(plan, results(usdValue("245122")), names)), {
    columns: [["Revenue", "FY2024"], ["Revenue", "FY2023"]],
    rows: [apple, ["Microsoft Corp.", ["out_b_rev2024", "USD 245,122.00", "FY2024"], ["out_b_rev2023", "USD 211,915.00", "FY2023"]]],
  });
  assert.deepEqual(readTable(present(plan, results(UNAVAILABLE), names)), {
    columns: [["Revenue", "FY2024"], ["Revenue", "FY2023"]],
    rows: [apple, ["Microsoft Corp.", ["out_b_rev2024", "A required input or calculation is unavailable.", "FY2024"], ["out_b_rev2023", "USD 211,915.00", "FY2023"]]],
  });
});

test("one company's QoQ and YoY growth are two lines, while QoQ growth over several quarters is one series (#470)", () => {
  const revenue = (back: number) => reportedAt(`rev${back}`, "a", "revenue", quarterBack(2026, "Q4", back));
  const growth = singleSubjectPlan(
    [revenue(0), revenue(1), revenue(4), change("qoq", "percent_change_positive_base", "rev0", "rev1"), change("yoy", "percent_change_positive_base", "rev0", "rev4")],
    ["rev0", "qoq", "yoy"],
  );
  const shown = present(growth, [committed("o_rev0", "rev0", usdValue("100")), committed("o_qoq", "qoq", percentValue("10")), committed("o_yoy", "yoy", percentValue("50"))], { a: "Alpha Corp" });
  assert.deepEqual(shown.presentations, [{ kind: "scalar", result_id: "r-o_rev0" }, { kind: "scalar", result_id: "r-o_qoq" }, { kind: "scalar", result_id: "r-o_yoy" }]);
  assert.deepEqual(labelTexts(shown, "o_qoq"), ["Alpha Corp", "Quarter-over-quarter percent change in Revenue", "Q4 FY2026 vs Q3 FY2026"]);
  assert.deepEqual(labelTexts(shown, "o_yoy"), ["Alpha Corp", "Year-over-year percent change in Revenue", "Q4 FY2026 vs Q4 FY2025"]);

  const run = singleSubjectPlan(
    [revenue(0), revenue(1), revenue(2), revenue(3), ...[2, 1, 0].map((back) => change(`qoq${back}`, "percent_change_positive_base", `rev${back}`, `rev${back + 1}`))],
    ["qoq2", "qoq1", "qoq0"],
  );
  const quarters = present(run, ["qoq2", "qoq1", "qoq0"].map((id, index) => committed(`o_${id}`, id, percentValue(`${index + 1}`))), { a: "Alpha Corp" });
  const [series, ...rest] = quarters.presentations;
  assert.deepEqual(rest, []);
  assert.ok(series?.kind === "series");
  assert.equal(quarters.labels[series.measure_label_id]!.text, "Quarter-over-quarter percent change in Revenue");
  assert.deepEqual(series.points.map((point) => [point.result_id, quarters.labels[point.period_label_id]!.text]), [
    ["r-o_qoq2", "Q2 FY2026 vs Q1 FY2026"],
    ["r-o_qoq1", "Q3 FY2026 vs Q2 FY2026"],
    ["r-o_qoq0", "Q4 FY2026 vs Q3 FY2026"],
  ]);
});

test("a change names its horizon from its periods' structure, and two unknown horizons never share a measure", () => {
  const latest = (period_type: "annual" | "quarterly", offset: number): PeriodSelector => ({ kind: "latest", period_type, offset });
  const plan = singleSubjectPlan(
    [
      reportedAt("q4", "a", "revenue", quarterBack(2026, "Q4", 0)),
      reportedAt("q3", "a", "revenue", quarterBack(2026, "Q4", 1)),
      reportedAt("q2", "a", "revenue", quarterBack(2026, "Q4", 2)),
      reportedAt("q4_25", "a", "revenue", quarterBack(2026, "Q4", 4)),
      reportedAt("fy26", "a", "revenue", FY(2026)),
      reportedAt("fy24", "a", "revenue", FY(2024)),
      reportedAt("lq0", "a", "revenue", latest("quarterly", 0)),
      reportedAt("lq1", "a", "revenue", latest("quarterly", 1)),
      reportedAt("la0", "a", "revenue", latest("annual", 0)),
      reportedAt("la2", "a", "revenue", latest("annual", 2)),
      reportedAt("cut", "a", "revenue", { kind: "at_cutoff" }),
      change("abs_qoq", "absolute_change", "q4", "q3"),
      change("pct_2q", "percent_change_positive_base", "q4", "q2"),
      change("abs_yoy", "absolute_change", "q4", "q4_25"),
      change("abs_2y", "absolute_change", "fy26", "fy24"),
      change("pct_2y", "percent_change_positive_base", "fy26", "fy24"),
      change("pct_latest_q", "percent_change_positive_base", "lq0", "lq1"),
      change("abs_latest_2y", "absolute_change", "la0", "la2"),
      change("pct_mixed", "percent_change_positive_base", "fy26", "q4"),
      change("pct_backwards", "percent_change_positive_base", "q3", "q4"),
      change("pct_cutoff", "percent_change_positive_base", "cut", "la0"),
      change("pct_calendars", "percent_change_positive_base", "q4", "lq1"),
    ],
    ["abs_qoq", "pct_2q", "abs_yoy", "abs_2y", "pct_2y", "pct_latest_q", "abs_latest_2y", "pct_mixed", "pct_backwards", "pct_cutoff", "pct_calendars"],
  );
  const ids = plan.outputs.map((output) => output.node_id);
  const content = present(plan, ids.map((id) => committed(`o_${id}`, id, usdValue("1"))), { a: "Alpha Corp" });
  assert.deepEqual(Object.fromEntries(ids.map((id) => [id, labelTexts(content, `o_${id}`)[1]])), {
    abs_qoq: "Quarter-over-quarter change in Revenue",
    pct_2q: "Percent change in Revenue over 2 quarters",
    abs_yoy: "Year-over-year change in Revenue",
    abs_2y: "Change in Revenue over 2 fiscal years",
    pct_2y: "Percent change in Revenue over 2 fiscal years",
    pct_latest_q: "Quarter-over-quarter percent change in Revenue",
    abs_latest_2y: "Change in Revenue over 2 fiscal years",
    pct_mixed: "Percent change in Revenue",
    pct_backwards: "Percent change in Revenue",
    pct_cutoff: "Percent change in Revenue",
    pct_calendars: "Percent change in Revenue",
  });
  const unknown = ["pct_mixed", "pct_backwards", "pct_cutoff", "pct_calendars"].map((id) => result(content, `o_${id}`).measure_label_id);
  assert.equal(new Set(unknown).size, 4, "same text, four measures");
});

const ttm = (node_id: string, quarters: string[]) => ({ node_id, operation: "trailing_sum" as const, operation_version: "trailing_sum.v1", quarters });
/** A company's trailing-four-quarter revenue, its quarters listed in `back` order (quarters before `newest`). */
const trailingRevenue = (slot: string, [year, quarter]: [number, Parameters<typeof quarterBack>[1]], back: number[]) => [
  ...back.map((n) => reportedAt(`${slot}_rev${n}`, slot, "revenue", quarterBack(year, quarter, n))),
  ttm(`${slot}_ttm`, back.map((n) => `${slot}_rev${n}`)),
];
const TTM_Q4_FY2026 = "Q4 FY2026 vs Q3 FY2026 vs Q2 FY2026 vs Q1 FY2026";

test("a change is dated by its current period and reads each side's quarters newest first, whatever order the planner listed them in", () => {
  const quarters = [0, 1, 2, 3, 4, 5, 6, 7].map((back) => reportedAt(`rev${back}`, "a", "revenue", quarterBack(2026, "Q4", back)));
  const plan = singleSubjectPlan(
    [...quarters, ttm("ttm", ["rev2", "rev0", "rev3", "rev1"]), ttm("ttm_prior", ["rev7", "rev6", "rev5", "rev4"]), change("yoy", "percent_change_positive_base", "ttm", "ttm_prior")],
    ["yoy"],
  );
  const content = present(plan, [committed("o_yoy", "yoy", percentValue("12"))], { a: "Alpha Corp" });
  assert.deepEqual(labelTexts(content, "o_yoy"), [
    "Alpha Corp",
    "Year-over-year percent change in Revenue, trailing four quarters",
    `${TTM_Q4_FY2026} vs Q4 FY2025 vs Q3 FY2025 vs Q2 FY2025 vs Q1 FY2025`,
  ]);
});

test("two companies on one calendar share a trailing-sum column that names its period, whatever order each lists its quarters in", () => {
  const plan = comparisonPlan([...trailingRevenue("a", [2026, "Q4"], [0, 1, 2, 3]), ...trailingRevenue("b", [2026, "Q4"], [3, 2, 1, 0])], ["a_ttm", "b_ttm"]);
  const content = present(plan, [committed("o_a_ttm", "a_ttm", usdValue("400")), committed("o_b_ttm", "b_ttm", usdValue("160"))]);
  assert.deepEqual(readTable(content), {
    columns: [["Revenue, trailing four quarters", TTM_Q4_FY2026]],
    rows: [["Alpha Corp", ["o_a_ttm", "USD 400.00", TTM_Q4_FY2026]], ["Beta Inc", ["o_b_ttm", "USD 160.00", TTM_Q4_FY2026]]],
  });
});

test("two companies on different calendars share a trailing-sum column, whatever order each lists its quarters in", () => {
  const plan = comparisonPlan([...trailingRevenue("a", [2026, "Q4"], [3, 2, 1, 0]), ...trailingRevenue("b", [2026, "Q2"], [0, 1, 2, 3])], ["a_ttm", "b_ttm"]);
  const content = present(plan, [committed("o_a_ttm", "a_ttm", usdValue("400")), committed("o_b_ttm", "b_ttm", usdValue("160"))], NVDA_AMD);
  assert.deepEqual(readTable(content), {
    columns: [["Revenue, trailing four quarters", null]],
    rows: [
      ["NVIDIA Corp", ["o_a_ttm", "USD 400.00", TTM_Q4_FY2026]],
      ["Advanced Micro Devices", ["o_b_ttm", "USD 160.00", "Q2 FY2026 vs Q1 FY2026 vs Q4 FY2025 vs Q3 FY2025"]],
    ],
  });
});

test("a company read at a fiscal quarter and one read at its latest quarter share one column", () => {
  const plan = comparisonPlan(
    [reportedAt("a_rev", "a", "revenue", quarterBack(2026, "Q4", 0)), reportedAt("b_rev", "b", "revenue", { kind: "latest", period_type: "quarterly", offset: 0 })],
    ["a_rev", "b_rev"],
  );
  const content = present(plan, [committed("o_a_rev", "a_rev", usdValue("100")), committed("o_b_rev", "b_rev", usdValue("40"))], NVDA_AMD);
  assert.deepEqual(readTable(content), {
    columns: [["Revenue", null]],
    rows: [["NVIDIA Corp", ["o_a_rev", "USD 100.00", "Q4 FY2026"]], ["Advanced Micro Devices", ["o_b_rev", "USD 40.00", "latest fiscal quarter"]]],
  });
});

test("two margins of one company over different periods are two lines, whatever order each company lists them in", () => {
  const margins = (slot: string) => [
    reportedAt(`${slot}_gp`, slot, "gross_profit", quarterBack(2026, "Q4", 0)),
    reportedAt(`${slot}_rev`, slot, "revenue", quarterBack(2026, "Q4", 0)),
    reportedAt(`${slot}_rev_q3`, slot, "revenue", quarterBack(2026, "Q4", 1)),
    { node_id: `${slot}_same`, operation: "gross_margin" as const, operation_version: "gross_margin.v1", numerator: `${slot}_gp`, revenue: `${slot}_rev` },
    { node_id: `${slot}_cross`, operation: "gross_margin" as const, operation_version: "gross_margin.v1", numerator: `${slot}_gp`, revenue: `${slot}_rev_q3` },
  ];
  const plan = comparisonPlan([...margins("a"), ...margins("b")], ["a_same", "a_cross", "b_cross", "b_same"]);
  const content = present(plan, [
    committed("o_a_same", "a_same", ratioValue("0.75")),
    committed("o_a_cross", "a_cross", ratioValue("0.8")),
    committed("o_b_cross", "b_cross", ratioValue("0.6")),
    committed("o_b_same", "b_same", ratioValue("0.5")),
  ], NVDA_AMD);
  assert.deepEqual(readTable(content), {
    columns: [["Gross margin (gross profit / revenue)", "Q4 FY2026"], ["Gross margin (gross profit / revenue)", "Q4 FY2026 vs Q3 FY2026"]],
    rows: [
      ["NVIDIA Corp", ["o_a_same", "75.00%", "Q4 FY2026"], ["o_a_cross", "80.00%", "Q4 FY2026 vs Q3 FY2026"]],
      ["Advanced Micro Devices", ["o_b_same", "50.00%", "Q4 FY2026"], ["o_b_cross", "60.00%", "Q4 FY2026 vs Q3 FY2026"]],
    ],
  });
});

test("a column names a period only when every company has a cell there and all read that period", () => {
  const plan = comparisonPlan(
    [reportedAt("a_rev25", "a", "revenue", FY(2025)), reportedAt("a_rev24", "a", "revenue", FY(2024)), reportedAt("b_rev24", "b", "revenue", FY(2024))],
    ["a_rev25", "a_rev24", "b_rev24"],
  );
  const content = present(plan, [committed("o_a_rev25", "a_rev25", usdValue("120")), committed("o_a_rev24", "a_rev24", usdValue("100")), committed("o_b_rev24", "b_rev24", usdValue("40"))], NVDA_AMD);
  assert.deepEqual(readTable(content), {
    columns: [["Revenue", null], ["Revenue", null]],
    rows: [
      ["NVIDIA Corp", ["o_a_rev25", "USD 120.00", "FY2025"], ["o_a_rev24", "USD 100.00", "FY2024"]],
      ["Advanced Micro Devices", ["o_b_rev24", "USD 40.00", "FY2024"], null],
    ],
  });
});

test("a threshold check is never a column, whether it verified or gapped", () => {
  const plan = mutable(planFixture()) as FinancialPlanV1;
  plan.operations.push({ node_id: "b_gm_check", operation: "threshold", operation_version: "threshold.v1", subject: "b_gm", threshold_id: "min_gm", comparison: "gte" });
  plan.outputs.push({ output_id: "out_b_check", node_id: "b_gm_check", unit_id: "section" });
  const content = present(plan, comparisonResults({
    out_check: committed("out_check", "a_gm_check", UNAVAILABLE, "missing"),
    out_b_check: committed("out_b_check", "b_gm_check", { kind: "predicate", predicate: "threshold", comparison: "gte", outcome: false }),
  }));
  assert.deepEqual(readTable(content).columns, [["Revenue", null], ["Gross margin (gross profit / revenue)", "FY2023"]]);
  assert.deepEqual(content.presentations.filter((presentation) => presentation.kind !== "table"), [
    { kind: "gap", result_id: "r-out_check" },
    { kind: "predicate", result_id: "r-out_rank" },
    { kind: "predicate", result_id: "r-out_b_check" },
  ]);
});

test("a series is one line over several periods: never threshold checks, never a year beside a quarter", () => {
  const checks = singleSubjectPlan(
    [
      reportedAt("rev25", "a", "revenue", FY(2025)),
      reportedAt("rev24", "a", "revenue", FY(2024)),
      ...["rev25", "rev24"].map((subject) => ({ node_id: `${subject}_check`, operation: "threshold" as const, operation_version: "threshold.v1", subject, threshold_id: "min_rev", comparison: "gte" as const })),
    ],
    ["rev25_check", "rev24_check"],
    [{ threshold_id: "min_rev", value: "100", unit: { kind: "currency", currency: "USD" }, attribution: { kind: "user_request", ref: "chat:turn:1" } }],
  );
  const gapped = present(checks, [committed("o_rev25_check", "rev25_check", UNAVAILABLE, "missing"), committed("o_rev24_check", "rev24_check", UNAVAILABLE, "missing")], { a: "Alpha Corp" });
  assert.deepEqual(gapped.presentations, [{ kind: "gap", result_id: "r-o_rev25_check" }, { kind: "gap", result_id: "r-o_rev24_check" }]);

  const yearAndQuarter = singleSubjectPlan([reportedAt("fy25", "a", "revenue", FY(2025)), reportedAt("q4", "a", "revenue", quarterBack(2025, "Q4", 0))], ["fy25", "q4"]);
  const shown = present(yearAndQuarter, [committed("o_fy25", "fy25", usdValue("400")), committed("o_q4", "q4", usdValue("110"))], { a: "Alpha Corp" });
  assert.deepEqual(shown.presentations, [{ kind: "scalar", result_id: "r-o_fy25" }, { kind: "scalar", result_id: "r-o_q4" }]);
});

test("a series is one calendar: fiscal years and the latest fiscal year have no common order", () => {
  const plan = singleSubjectPlan(
    [reportedAt("fy25", "a", "revenue", FY(2025)), reportedAt("fy24", "a", "revenue", FY(2024)), reportedAt("la0", "a", "revenue", { kind: "latest", period_type: "annual", offset: 0 })],
    ["fy25", "fy24", "la0"],
  );
  const content = present(plan, [committed("o_fy25", "fy25", usdValue("400")), committed("o_fy24", "fy24", usdValue("380")), committed("o_la0", "la0", usdValue("410"))], { a: "Alpha Corp" });
  const [series, ...rest] = content.presentations;
  assert.deepEqual(rest, [{ kind: "scalar", result_id: "r-o_la0" }]);
  assert.ok(series?.kind === "series");
  assert.deepEqual(series.points.map((point) => [point.result_id, content.labels[point.period_label_id]!.text]), [["r-o_fy25", "FY2025"], ["r-o_fy24", "FY2024"]]);
});

test("a changed label, unit, period, or denominator changes the presentation hash", () => {
  const baseline = presentationHash(present());
  assert.equal(presentationHash(present()), baseline, "presentation is deterministic");

  assert.notEqual(presentationHash(present(planFixture(), comparisonResults(), { a: "Alphabet Corp", b: "Beta Inc" })), baseline, "company label");

  const asPercent = comparisonResults({
    out_a_gm: committed("out_a_gm", "a_gm", { kind: "value", value: "0.41235", unit: { kind: "percent" }, exact: true, rounding: null }),
  });
  assert.notEqual(presentationHash(present(planFixture(), asPercent)), baseline, "percentage unit");
  assert.equal(resultText(present(planFixture(), asPercent), "out_a_gm"), "0.41%");

  const otherPeriod = mutable(planFixture()) as FinancialPlanV1;
  for (const node of otherPeriod.operations) if (node.operation === "reported_metric") node.period = { kind: "fiscal_period", fiscal_year: 2022, fiscal_period: "FY" };
  assert.notEqual(presentationHash(present(otherPeriod)), baseline, "period");

  const otherDenominator = mutable(planFixture()) as FinancialPlanV1;
  otherDenominator.operations = otherDenominator.operations.map((node) => node.node_id === "a_gm" ? { ...node, operation: "operating_margin", operation_version: "operating_margin.v1" } as never : node);
  const changed = present(otherDenominator);
  assert.equal(labelTexts(changed, "out_a_gm")[1], "Operating margin (operating income / revenue)");
  assert.notEqual(presentationHash(changed), baseline, "hidden denominator");
});

test("presentation content has no free-text field a model could fill", () => {
  const content = present();
  const allowedText = new Set(Object.values(content.labels).map((label) => label.text));
  for (const result of content.results) {
    allowedText.add(result.presented.text);
    if (result.presented.kind === "value") allowedText.add(result.presented.full_text);
  }
  for (const presentation of content.presentations) if (presentation.kind === "table") allowedText.add(presentation.caption);
  // Every string in the content is either an identifier/enum or one of the generated texts above.
  const strings: string[] = [];
  const walk = (value: unknown, key: string) => {
    if (typeof value === "string") {
      if (/\s/u.test(value) && !allowedText.has(value)) strings.push(`${key}=${value}`);
    } else if (Array.isArray(value)) value.forEach((entry) => walk(entry, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(content, "");
  assert.deepEqual(strings, []);
});

test("a result missing for a requested output or a subject without a name is refused", () => {
  assert.throws(() => present(planFixture(), comparisonResults().filter((result) => result.output_id !== "out_check")), /no committed result for output out_check/u);
  assert.throws(() => present(planFixture(), comparisonResults(), { a: "Alpha Corp" }), /no display name for subject slot b/u);
});

test("a ranking that could not be computed stands alone as a gap, never as a column no company fills", () => {
  const content = present(planFixture(), comparisonResults({ out_rank: committed("out_rank", "gm_rank", UNAVAILABLE, "missing") }));
  assert.deepEqual(readTable(content).columns, [["Revenue", null], ["Gross margin (gross profit / revenue)", "FY2023"]]);
  assert.deepEqual(content.presentations.filter((presentation) => presentation.kind !== "table"), [{ kind: "predicate", result_id: "r-out_check" }, { kind: "gap", result_id: "r-out_rank" }]);
});

const fy2023 = (end: string): BoundPeriod => ({ fiscal_year: 2023, fiscal_period: "FY", end });
const BOUND_TOGETHER = { a_rev: fy2023("2023-12-31"), a_gp: fy2023("2023-12-31"), b_rev: fy2023("2023-12-31"), b_gp: fy2023("2023-12-31") };
// Alpha's fiscal 2023 ends in January and Beta's in September.
const BOUND_APART = { ...BOUND_TOGETHER, a_rev: fy2023("2023-01-29"), a_gp: fy2023("2023-01-29"), b_rev: fy2023("2023-09-30"), b_gp: fy2023("2023-09-30") };
const gapOf = (output: string, node: string, explanation: string) =>
  committed(output, node, { kind: "gap", reason_code: "incompatible_period", explanation }, "incompatible");

test("a fiscal year the companies end on different dates names each cell's end, and the ranking's gap names each company's (#541)", () => {
  const together = present(planFixture(), comparisonResults(), NAMES, BOUND_TOGETHER);
  assert.deepEqual(readTable(together).columns, [["Revenue", null], ["Gross margin (gross profit / revenue)", "FY2023 (ended 2023-12-31)"]], "one end date: named once, in the heading");
  assert.deepEqual(labelTexts(together, "out_rank"), [null, "Gross margin (gross profit / revenue) ranking", "FY2023 (ended 2023-12-31)"]);

  const content = present(planFixture(), comparisonResults({ out_rank: gapOf("out_rank", "gm_rank", "The cohort members cover different periods.") }), NAMES, BOUND_APART);
  assert.deepEqual(readTable(content), {
    columns: [["Revenue", null], ["Gross margin (gross profit / revenue)", null]],
    rows: [
      ["Alpha Corp", ["out_a_rev", "USD 1,234,567.89", "FY2023 (ended 2023-01-29)"], ["out_a_gm", "41.24%", "FY2023 (ended 2023-01-29)"]],
      ["Beta Inc", null, ["out_b_gm", "38.00%", "FY2023 (ended 2023-09-30)"]],
    ],
  });
  assert.deepEqual(labelTexts(content, "out_rank"), [null, "Gross margin (gross profit / revenue) ranking", "FY2023"]);
  assert.equal(resultText(content, "out_rank"), "The cohort members cover different periods. Alpha Corp's FY2023 ended 2023-01-29 and Beta Inc's FY2023 ended 2023-09-30.");
});

test("a margin whose operands were bound to periods ending on different dates names each operand's (#541)", () => {
  const content = present(planFixture(), comparisonResults({ out_a_gm: gapOf("out_a_gm", "a_gm", "The operands cover different periods.") }), NAMES, { ...BOUND_TOGETHER, a_gp: fy2023("2023-12-30") });
  assert.equal(resultText(content, "out_a_gm"), "The operands cover different periods. Gross profit's FY2023 ended 2023-12-30 and revenue's FY2023 ended 2023-12-31.");
});

const LATEST_YEAR = { kind: "latest" as const, period_type: "annual" as const, offset: 0 };

test("a node named like an object's own property has no bound period: its gap and its margin's still present (#541)", () => {
  const plan = singleSubjectPlan([
    reportedAt("gp", "a", "gross_profit", LATEST_YEAR),
    reportedAt("constructor", "a", "revenue", LATEST_YEAR),
    { node_id: "gm", operation: "gross_margin", operation_version: "gross_margin.v1", numerator: "gp", revenue: "constructor" },
  ], ["constructor", "gm"]);
  const content = present(plan, [committed("o_constructor", "constructor", UNAVAILABLE, "missing"), committed("o_gm", "gm", UNAVAILABLE, "missing")], { a: "Alpha Corp" });
  assert.deepEqual(content.results.map((entry) => [entry.output_id, content.labels[entry.period_label_id]!.text, entry.presented.text]), [
    ["o_constructor", "latest fiscal year", "A required input or calculation is unavailable."],
    ["o_gm", "latest fiscal year", "A required input or calculation is unavailable."],
  ]);
});

test("a fiscal year asked by name and one asked as the latest are each dated, and the cohort's gap names both (#541)", () => {
  const plan = comparisonPlan([
    reportedAt("a_rev", "a", "revenue", FY(2025)),
    reportedAt("b_rev", "b", "revenue", LATEST_YEAR),
    { node_id: "rank", operation: "peer_compare", operation_version: "peer_compare.v1", members: ["a_rev", "b_rev"], direction: "highest" },
  ], ["a_rev", "b_rev", "rank"]);
  const fy2025 = (end: string): BoundPeriod => ({ fiscal_year: 2025, fiscal_period: "FY", end });
  const content = present(plan, [
    committed("o_a_rev", "a_rev", usdValue("130497")),
    committed("o_b_rev", "b_rev", usdValue("416161")),
    committed("o_rank", "rank", { kind: "gap", reason_code: "incompatible_period", explanation: "The cohort members cover different periods." }, "incompatible"),
  ], { a: "NVIDIA Corp", b: "Apple Inc." }, { a_rev: fy2025("2025-01-26"), b_rev: fy2025("2025-09-27") });
  assert.deepEqual(readTable(content).rows, [
    ["NVIDIA Corp", ["o_a_rev", "USD 130,497.00", "FY2025 (ended 2025-01-26)"]],
    ["Apple Inc.", ["o_b_rev", "USD 416,161.00", "FY2025 (ended 2025-09-27)"]],
  ]);
  assert.equal(resultText(content, "o_rank"), "The cohort members cover different periods. NVIDIA Corp's FY2025 ended 2025-01-26 and Apple Inc.'s FY2025 ended 2025-09-27.");
});

test("every period a value was bound to is dated, so a change never dates one side alone (#540, #541)", () => {
  const plan = overviewComparisonPlan([{ slot: "a", newest: [2026, "Q3"] }, { slot: "b", newest: [2026, "Q2"] }]);
  const quarter = (fiscal_year: number, fiscal_period: BoundPeriod["fiscal_period"], end: string): BoundPeriod => ({ fiscal_year, fiscal_period, end });
  const latest = { a: quarter(2026, "Q3", "2026-06-27"), b: quarter(2026, "Q2", "2026-06-27") };
  const periods: Record<string, BoundPeriod> = {
    a_rev_q1: quarter(2026, "Q2", "2026-03-28"), a_rev_q4: quarter(2025, "Q3", "2025-06-28"),
    b_rev_q1: quarter(2026, "Q1", "2026-03-28"), b_rev_q4: quarter(2025, "Q2", "2025-06-28"),
  };
  for (const slot of ["a", "b"] as const) for (const line of ["rev", "gp", "oi", "ni"]) periods[`${slot}_${line}`] = latest[slot];
  const content = present(plan, [...linesOf("a", NVDA_LINES), ...linesOf("b", AMD_LINES)], { a: "Apple Inc.", b: "Advanced Micro Devices" }, periods);
  assert.deepEqual(["out_a_rev", "out_a_qoq", "out_b_rev", "out_b_yoy"].map((output) => labelTexts(content, output)[2]), [
    "Q3 FY2026 (ended 2026-06-27)",
    "Q3 FY2026 (ended 2026-06-27) vs Q2 FY2026 (ended 2026-03-28)",
    "Q2 FY2026 (ended 2026-06-27)",
    "Q2 FY2026 (ended 2026-06-27) vs Q2 FY2025 (ended 2025-06-28)",
  ]);
});

test("a window of latest quarters names each by the quarter it was bound to, and a gap by its place before the latest (#540)", () => {
  const latestQuarter = (offset: number) => ({ kind: "latest" as const, period_type: "quarterly" as const, offset });
  const plan = singleSubjectPlan([
    ...[3, 2, 1, 0].map((offset) => reportedAt(`q${offset}`, "a", "revenue", latestQuarter(offset))),
    { node_id: "window", operation: "period_rank", operation_version: "period_rank.v1", members: ["q3", "q2", "q1", "q0"], direction: "lowest" },
  ], ["q3", "q2", "q1", "q0", "window"]);
  const content = present(plan, [
    committed("o_q3", "q3", usdValue("20")),
    committed("o_q2", "q2", UNAVAILABLE, "missing"),
    committed("o_q1", "q1", usdValue("10")),
    committed("o_q0", "q0", usdValue("30")),
    committed("o_window", "window", {
      kind: "ranking", direction: "lowest", population: { requested: 4, evaluated: 3 }, complete: false,
      ranks: [{ node_id: "q3", rank: 2 }, { node_id: "q1", rank: 1 }, { node_id: "q0", rank: 3 }], extreme: ["q1"],
    }),
  ], { a: "Alpha Corp" }, {
    q3: { fiscal_year: 2025, fiscal_period: "Q3", end: "2025-09-27" },
    q1: { fiscal_year: 2026, fiscal_period: "Q1", end: "2026-03-28" },
    q0: { fiscal_year: 2026, fiscal_period: "Q2", end: "2026-06-27" },
  });
  assert.deepEqual(["o_q3", "o_q2", "o_q1", "o_q0", "o_window"].map((output) => labelTexts(content, output)[2]), [
    "Q3 FY2025 (ended 2025-09-27)",
    "fiscal quarter 2 before latest",
    "Q1 FY2026 (ended 2026-03-28)",
    "Q2 FY2026 (ended 2026-06-27)",
    "Q3 FY2025 (ended 2025-09-27) to Q2 FY2026 (ended 2026-06-27)",
  ]);
  assert.equal(resultText(content, "o_window"), "Q1 FY2026 (ended 2026-03-28) has the lowest revenue of the 3 of 4 quarters ranked");
});

test("an instant names the day its value stands at, never calling it its period's end: a balance and a cover count (#540)", () => {
  const latestQuarter = { kind: "latest" as const, period_type: "quarterly" as const, offset: 0 };
  const plan = singleSubjectPlan([
    reportedAt("cash", "a", "cash_and_equivalents", latestQuarter),
    reportedAt("shares", "a", "shares_outstanding", latestQuarter),
    balance("ta23", "total_assets"),
    balance("ta22", "total_assets", 2022),
    { node_id: "ta_change", operation: "absolute_change", operation_version: "absolute_change.v1", current: "ta23", prior: "ta22" },
  ], ["cash", "shares", "ta_change"]);
  const content = present(plan, [
    committed("o_cash", "cash", usdValue("100")),
    committed("o_shares", "shares", valueOf("24640000000", { kind: "shares" })),
    committed("o_ta_change", "ta_change", usdValue("50")),
  ], { a: "Alpha Corp" }, {
    // The quarter ended 2024-04-28; its 10-Q's cover counted the shares on 2024-05-17.
    cash: { fiscal_year: 2025, fiscal_period: "Q1", end: "2024-04-28" },
    shares: { fiscal_year: 2025, fiscal_period: "Q1", end: "2024-05-17" },
    ta23: fy2023("2023-12-31"),
    ta22: { fiscal_year: 2022, fiscal_period: "FY", end: "2022-12-31" },
  });
  assert.deepEqual(["o_cash", "o_shares", "o_ta_change"].map((output) => labelTexts(content, output)[2]), [
    "Q1 FY2025 (as of 2024-04-28)",
    "Q1 FY2025 (as of 2024-05-17)",
    "FY2023 (as of 2023-12-31) vs FY2022 (as of 2022-12-31)",
  ]);
});

test("a cohort of cover counts taken on different days names each day, never as its period's end (#540)", () => {
  const latestQuarter = { kind: "latest" as const, period_type: "quarterly" as const, offset: 0 };
  const plan = comparisonPlan([
    reportedAt("a_shares", "a", "shares_outstanding", latestQuarter),
    reportedAt("b_shares", "b", "shares_outstanding", latestQuarter),
    { node_id: "rank", operation: "peer_compare", operation_version: "peer_compare.v1", members: ["a_shares", "b_shares"], direction: "highest" },
  ], ["rank"]);
  const content = present(plan, [
    committed("o_rank", "rank", { kind: "gap", reason_code: "incompatible_period", explanation: "The cohort members cover different periods." }, "incompatible"),
  ], NAMES, {
    a_shares: { fiscal_year: 2025, fiscal_period: "Q1", end: "2024-05-17" },
    b_shares: { fiscal_year: 2024, fiscal_period: "Q1", end: "2024-04-26" },
  });
  assert.equal(resultText(content, "o_rank"), "The cohort members cover different periods. Alpha Corp's Q1 FY2025 figure is as of 2024-05-17 and Beta Inc's Q1 FY2024 figure is as of 2024-04-26.");
});

test("a ratio's operands read mid-sentence in lower case, each with its own possessive (#541)", () => {
  const plan = singleSubjectPlan([
    balance("tl", "total_liabilities"),
    balance("ta", "total_assets"),
    { node_id: "lta", operation: "ratio", operation_version: "ratio.v1", ratio_key: "liabilities_to_assets", numerator: "tl", denominator: "ta" },
  ], ["lta"]);
  const content = present(plan, [committed("o_lta", "lta", { kind: "gap", reason_code: "incompatible_period", explanation: "The operands cover different periods." }, "incompatible")], { a: "Alpha Corp" }, {
    tl: fy2023("2023-12-30"),
    ta: fy2023("2023-12-31"),
  });
  assert.equal(resultText(content, "o_lta"), "The operands cover different periods. Total liabilities' FY2023 figure is as of 2023-12-30 and total assets' FY2023 figure is as of 2023-12-31.");
});

test("a change's gap keeps the engine's words, which already say which side is current (#541)", () => {
  const plan = singleSubjectPlan([
    balance("ta23", "total_assets"),
    balance("ta22", "total_assets", 2022),
    { node_id: "ta_change", operation: "absolute_change", operation_version: "absolute_change.v1", current: "ta23", prior: "ta22" },
  ], ["ta_change"]);
  const content = present(plan, [gapOf("o_ta_change", "ta_change", "The prior period must end before the current period.")], { a: "Alpha Corp" }, {
    ta23: fy2023("2023-12-31"),
    ta22: { fiscal_year: 2022, fiscal_period: "FY", end: "2024-01-31" },
  });
  assert.equal(resultText(content, "o_ta_change"), "The prior period must end before the current period.");
});

test("a trailing sum's own gap keeps the engine's words, never listing its quarters (#541)", () => {
  const plan = singleSubjectPlan(trailingRevenue("a", [2025, "Q4"], [0, 1, 2, 3]), ["a_ttm"]);
  const periods: Record<string, BoundPeriod> = {};
  ["2025-01-26", "2024-10-27", "2024-07-28", "2024-04-28"].forEach((end, n) => {
    const { fiscal_year, fiscal_period } = quarterBack(2025, "Q4", n) as Extract<PeriodSelector, { kind: "fiscal_period" }>;
    periods[`a_rev${n}`] = { fiscal_year, fiscal_period, end };
  });
  const content = present(plan, [gapOf("o_a_ttm", "a_ttm", "Quarters must share one fiscal calendar version.")], { a: "Alpha Corp" }, periods);
  assert.equal(resultText(content, "o_a_ttm"), "Quarters must share one fiscal calendar version.");
});

test("a cohort of trailing sums over different months keeps the engine's words, never naming one quarter as a sum's period (#541)", () => {
  const plan = comparisonPlan([
    ...trailingRevenue("a", [2025, "Q4"], [0, 1, 2, 3]),
    ...trailingRevenue("b", [2025, "Q4"], [0, 1, 2, 3]),
    { node_id: "rank", operation: "peer_compare", operation_version: "peer_compare.v1", members: ["a_ttm", "b_ttm"], direction: "highest" },
  ], ["rank"]);
  const ends = { a: ["2025-01-26", "2024-10-27", "2024-07-28", "2024-04-28"], b: ["2025-09-27", "2025-06-28", "2025-03-29", "2024-12-28"] };
  const periods: Record<string, BoundPeriod> = {};
  for (const slot of ["a", "b"] as const) {
    ends[slot].forEach((end, n) => {
      const { fiscal_year, fiscal_period } = quarterBack(2025, "Q4", n) as Extract<PeriodSelector, { kind: "fiscal_period" }>;
      periods[`${slot}_rev${n}`] = { fiscal_year, fiscal_period, end };
    });
  }
  const content = present(plan, [committed("o_rank", "rank", { kind: "gap", reason_code: "incompatible_period", explanation: "The cohort members cover different periods." }, "incompatible")], NAMES, periods);
  assert.equal(resultText(content, "o_rank"), "The cohort members cover different periods.");
});
