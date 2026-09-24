import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialPlanV1 } from "../src/contracts.ts";
import { parseDerivedDecimalText } from "../src/exact-decimal.ts";
import { fixed, presentationHash, presentFinancialUnit, type CommittedResult, type FinancialAnswerContent } from "../src/presentation.ts";
import { mutable, planFixture } from "./fixtures.ts";

const HASH = "a".repeat(64);
const NAMES = { a: "Alpha Corp", b: "Beta Inc" };

function committed(output_id: string, node_id: string, payload: unknown, disposition = "computed"): CommittedResult {
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

function present(plan: FinancialPlanV1 = planFixture(), results = comparisonResults(), names: Record<string, string> = NAMES): FinancialAnswerContent {
  return presentFinancialUnit({ plan, run_id: "run-1", unit_id: "section", results, subject_names: names });
}

function resultText(content: FinancialAnswerContent, outputId: string): string {
  return content.results.find((result) => result.output_id === outputId)!.presented.text;
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
  assert.equal(content.presentation_version, "financial-presentation.v1");
  assert.equal(content.template_version, "financial-answer.v1");
  assert.deepEqual(content.coverage, { state: "complete", requested: 5, verified: 5 });
  assert.equal(content.labels["subject:a"]!.text, "Alpha Corp");
  assert.equal(content.labels["measure:a_gm"]!.text, "Gross margin (gross profit / revenue)", "the denominator is visible in the label");
  assert.equal(content.labels["period:a_gm"]!.text, "FY2023");

  const revenue = content.results.find((result) => result.output_id === "out_a_rev")!;
  assert.deepEqual(revenue.presented, {
    kind: "value", text: "USD 1,234,567.89", full_text: "USD 1234567.891", value: "1234567.891", unit: { kind: "currency", currency: "USD" }, exact: true,
  });
  assert.deepEqual(revenue.label_ids, ["subject:a", "measure:a_rev", "period:a_rev"]);
  assert.equal(revenue.disposition, "verified", "a computed result presents as verified");
  assert.equal(resultText(content, "out_a_gm"), "41.24%", "ratios are percentages rounded half-even");
  const margin = content.results.find((result) => result.output_id === "out_a_gm")!.presented;
  assert.ok(margin.kind === "value" && margin.full_text === "41.235%", "the full canonical value travels with the rounded label");
  assert.equal(resultText(content, "out_check"), "Alpha Corp — Gross margin (gross profit / revenue), FY2023, at or above 40.00%: yes");
  assert.equal(resultText(content, "out_rank"), "Highest: Alpha Corp");

  const table = content.presentations.find((presentation) => presentation.kind === "table");
  assert.ok(table && table.kind === "table");
  assert.deepEqual(table.rows.map((row) => row.label_id), ["subject:a", "subject:b"]);
  const gmColumn = table.columns.findIndex((column) => column.label_ids[0] === "measure:a_gm");
  assert.deepEqual(table.rows.map((row) => row.cells[gmColumn]), ["r-out_a_gm", "r-out_b_gm"]);
  assert.deepEqual(table.ascending[table.columns[gmColumn]!.column_id], [1, 0], "Beta's 38% sorts before Alpha's 41.235%");
  const revenueColumn = table.columns.findIndex((column) => column.label_ids[0] === "measure:a_rev");
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
  const gmColumn = table.columns.findIndex((column) => column.label_ids[0] === "measure:a_gm");
  assert.equal(resultText(content, "out_a_gm"), resultText(content, "out_b_gm"), "the display labels tie");
  assert.deepEqual(table.ascending[table.columns[gmColumn]!.column_id], [1, 0], "the exact values do not");
});

test("an incomplete ranking can order its members but never names a leader", () => {
  const results = comparisonResults({
    out_b_gm: committed("out_b_gm", "b_gm", { kind: "gap", reason_code: "missing_input", explanation: "A required input or calculation is unavailable." }, "missing_input"),
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
  assert.equal(gap.disposition, "missing_input");
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
  assert.equal(content.labels["measure:growth"]!.text, "Percent change in Revenue");
  assert.equal(content.labels["period:growth"]!.text, "FY2023 vs FY2022", "current before prior, from operand order");
  assert.deepEqual(content.presentations, [
    { kind: "series", subject_label_id: "subject:a", measure_label_id: "measure:rev22", points: [
      { period_label_id: "period:rev22", result_id: "r-o22" },
      { period_label_id: "period:rev23", result_id: "r-o23" },
    ] },
    { kind: "scalar", result_id: "r-og" },
  ]);
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
  assert.equal(changed.labels["measure:a_gm"]!.text, "Operating margin (operating income / revenue)");
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
