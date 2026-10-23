// period_rank.v1: one company's figure ranked across its own periods, the
// window's high or low, with ties explicit and a gap period left out.

import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialPlanV1, PeriodRankNode } from "../src/contracts.ts";
import { evaluatePlan } from "../src/coverage.ts";
import { operationGap, type FinancialOperand, type PredicateOutcome } from "../src/operations.ts";
import { periodRank } from "../src/predicates.ts";
import { presentFinancialUnit, type PresentedPayload } from "../src/presentation.ts";
import { validateFinancialPlan } from "../src/validate.ts";
import { mutable, planFixture } from "./fixtures.ts";
import { operand } from "./operand-fixtures.ts";

// NVDA's fiscal 2026 quarters.
const QUARTERS = {
  q1: { start: "2025-01-27", end: "2025-04-27", fiscal_year: 2026, fiscal_period: "Q1" },
  q2: { start: "2025-04-28", end: "2025-07-27", fiscal_year: 2026, fiscal_period: "Q2" },
  q3: { start: "2025-07-28", end: "2025-10-26", fiscal_year: 2026, fiscal_period: "Q3" },
  q4: { start: "2025-10-27", end: "2026-01-25", fiscal_year: 2026, fiscal_period: "Q4" },
} as const;
type QuarterKey = keyof typeof QUARTERS;
const REVENUE: Record<QuarterKey, string> = { q1: "10", q2: "30", q3: "30", q4: "20" };

const rank = (members: string[], direction: PeriodRankNode["direction"] = "highest"): PeriodRankNode =>
  ({ node_id: "window", operation: "period_rank", operation_version: "period_rank.v1", members, direction });
const revenue = (quarter: QuarterKey, slot: "a" | "b" = "a") => operand(quarter, { slot, metric: "revenue", value: REVENUE[quarter], ...QUARTERS[quarter] });
const all = (["q1", "q2", "q3", "q4"] as const).map((quarter) => revenue(quarter));

function ranking(outcome: PredicateOutcome) {
  assert.ok(outcome.ok, outcome.ok ? "" : `${outcome.reason_code}: ${outcome.explanation}`);
  return outcome.ok ? outcome.payload : null;
}

function gap(outcome: PredicateOutcome): [string, string] {
  assert.equal(outcome.ok, false, "expected a gap");
  return outcome.ok ? ["", ""] : [outcome.disposition, outcome.reason_code];
}

test("period_rank ranks one company's quarters with explicit ties, listing every tied leader", () => {
  assert.deepEqual(ranking(periodRank(rank(["q1", "q2", "q3", "q4"]), all)), {
    kind: "ranking",
    direction: "highest",
    population: { requested: 4, evaluated: 4 },
    complete: true,
    ranks: [{ node_id: "q1", rank: 4 }, { node_id: "q2", rank: 1 }, { node_id: "q3", rank: 1 }, { node_id: "q4", rank: 3 }],
    extreme: ["q2", "q3"],
  });
  const lowest = ranking(periodRank(rank(["q1", "q2", "q3", "q4"], "lowest"), all));
  assert.deepEqual(lowest?.kind === "ranking" && [lowest.ranks.map((entry) => entry.rank), lowest.extreme], [[1, 3, 3, 2], ["q1"]]);
});

test("a period with no value is left out and counted, and the leaders of the periods ranked are still named", () => {
  assert.deepEqual(ranking(periodRank(rank(["q1", "q2", "q3", "q4"]), [all[0]!, null, all[2]!, all[3]!])), {
    kind: "ranking",
    direction: "highest",
    population: { requested: 4, evaluated: 3 },
    complete: false,
    ranks: [{ node_id: "q1", rank: 3 }, { node_id: "q3", rank: 1 }, { node_id: "q4", rank: 2 }],
    extreme: ["q3"],
  });
  assert.deepEqual(gap(periodRank(rank(["q1", "q2"]), [null, null])), ["missing", "missing_input"]);
});

test("period_rank ranks one company and one measure over distinct quarters, or distinct years, only", () => {
  const amd = revenue("q2", "b");
  assert.deepEqual(gap(periodRank(rank(["q1", "q2"]), [all[0]!, amd])), ["incompatible", "incompatible_scope"], "two companies");
  const income = operand("q2", { metric: "net_income", value: "5", ...QUARTERS.q2 });
  assert.deepEqual(gap(periodRank(rank(["q1", "q2"]), [all[0]!, income])), ["incompatible", "incompatible_definition"], "two measures");
  const again = operand("q1_again", { metric: "revenue", value: "11", ...QUARTERS.q1 });
  assert.deepEqual(gap(periodRank(rank(["q1", "q1_again"]), [all[0]!, again])), ["incompatible", "overlapping_periods"], "one quarter twice");
  const shifted = operand("q1_shifted", { metric: "revenue", value: "11", start: "2025-03-01", end: "2025-05-31", fiscal_year: 2026, fiscal_period: "Q2" });
  assert.deepEqual(gap(periodRank(rank(["q1", "q1_shifted"]), [all[0]!, shifted])), ["incompatible", "overlapping_periods"], "overlapping quarters");
  const year = operand("fy", { metric: "revenue", value: "90", start: "2025-01-27", end: "2026-01-25", fiscal_year: 2026, fiscal_period: "FY" });
  assert.deepEqual(gap(periodRank(rank(["q4", "fy"]), [all[3]!, year])), ["incompatible", "incompatible_period"], "a quarter and a year");
  const cash = (nodeId: string, end: string, fiscal_period: "Q3" | "FY") => operand(nodeId, { metric: "cash_and_equivalents", value: "7", kind: "instant", end, fiscal_year: 2026, fiscal_period });
  assert.deepEqual(gap(periodRank(rank(["q3", "fy"]), [cash("q3", "2025-10-26", "Q3"), cash("fy", "2026-01-25", "FY")])), ["incompatible", "incompatible_period"], "a quarter-end balance and a year-end one");
});

test("a window with fewer than two periods valued is a gap, never a high of one value", () => {
  assert.deepEqual(gap(periodRank(rank(["q1", "q2", "q3"]), [null, all[1]!, null])), ["missing", "missing_input"]);
  assert.deepEqual(gap(periodRank(rank(["q2"]), [all[1]!])), ["missing", "missing_input"], "a window of one period");
});

function windowPlan(): FinancialPlanV1 {
  const plan = mutable(planFixture()) as FinancialPlanV1;
  plan.subjects = { ...plan.subjects, requested_count: 1, resolved_count: 1, members: [plan.subjects.members[0]!] };
  plan.metric_definitions = [{ metric_key: "revenue", definition_version: "revenue.v1" }];
  plan.operations = [
    ...Object.values(QUARTERS).map(({ fiscal_year, fiscal_period }) =>
      ({ node_id: `q${fiscal_period.slice(1)}`, operation: "reported_metric" as const, operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "revenue", period: { kind: "fiscal_period" as const, fiscal_year, fiscal_period } })),
    rank(["q1", "q2", "q3", "q4"]),
    { ...rank(["q1", "q2", "q3", "q4"], "lowest"), node_id: "window_low" },
  ];
  plan.outputs = ["q1", "q2", "q3", "q4", "window", "window_low"].map((node_id) => ({ output_id: `out_${node_id}`, node_id, unit_id: "section" }));
  plan.thresholds = [];
  const validated = validateFinancialPlan(plan);
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

test("a period whose input is missing does not block the ranking", () => {
  const plan = windowPlan();
  const evaluation = evaluatePlan(plan, (node) => {
    if (node.node_id === "q2") return operationGap("missing_input", "No eligible input.");
    const result: FinancialOperand = revenue(node.node_id as QuarterKey);
    return { ok: true, operand: result, payload: { kind: "value", value: REVENUE[node.node_id as QuarterKey], unit: result.measurement.unit, exact: true, rounding: null } };
  });
  const state = evaluation.outputs.find((output) => output.output_id === "out_window")!.state;
  assert.deepEqual(state.status === "computed" && state.payload.kind === "ranking" && [state.payload.population, state.payload.extreme], [{ requested: 4, evaluated: 3 }, ["q3"]]);
});

test("the presentation names the high and low periods, how many it ranked, and each period's rank", () => {
  const plan = windowPlan();
  const present = (high: unknown, low: unknown) => presentFinancialUnit({
    plan,
    run_id: "44444444-4444-4444-8444-444444444444",
    unit_id: "section",
    subject_names: { a: "NVIDIA" },
    results: plan.outputs.map((output, index) => ({
      result_id: `55555555-5555-4555-8555-00000000000${index}`,
      output_id: output.output_id,
      node_id: output.node_id,
      disposition: "computed",
      payload: index === 4 ? high : index === 5 ? low : { kind: "value", value: Object.values(REVENUE)[index], unit: { kind: "currency", currency: "USD" }, exact: true, rounding: null },
      result_hash: "f".repeat(64),
    })),
  });
  const content = present(
    ranking(periodRank(rank(["q1", "q2", "q3", "q4"]), all)),
    ranking(periodRank(rank(["q1", "q2", "q3", "q4"], "lowest"), [all[0]!, null, all[2]!, all[3]!])),
  );
  const label = (id: string) => content.labels[id]!.text;
  const presented = (index: number) => {
    const { presented: payload } = content.results[index]!;
    assert.equal(payload.kind, "ranking");
    return payload as Extract<PresentedPayload, { kind: "ranking" }>;
  };
  const window = content.results[4]!;
  assert.deepEqual([window.subject_label_id, label(window.measure_label_id), label(window.period_label_id)], ["subject:a", "Revenue ranked across periods", "Q1 FY2026 to Q4 FY2026"]);
  const high = presented(4);
  assert.equal(high.text, "Q2 FY2026 and Q3 FY2026 tie for the highest revenue of the 4 quarters ranked");
  assert.deepEqual(high.order.map((entry) => ["period_label_id" in entry ? label(entry.period_label_id) : null, entry.rank]), [["Q1 FY2026", 4], ["Q2 FY2026", 1], ["Q3 FY2026", 1], ["Q4 FY2026", 3]]);
  assert.deepEqual(high.leader_label_ids?.map(label), ["Q2 FY2026", "Q3 FY2026"]);
  const low = presented(5);
  assert.deepEqual([low.text, low.complete, low.leader_label_ids], ["Q1 FY2026 has the lowest revenue of the 3 of 4 quarters ranked", false, null]);
  assert.deepEqual(content.presentations.map((presentation) => presentation.kind), ["series", "predicate", "predicate"]);
});

test("a window's period is its own label, never a trailing sum's over the same quarters", () => {
  const plan = mutable(windowPlan()) as FinancialPlanV1;
  plan.operations = [
    ...plan.operations.filter((node) => node.operation === "reported_metric"),
    { node_id: "ttm", operation: "trailing_sum", operation_version: "trailing_sum.v1", quarters: ["q1", "q2", "q3", "q4"] },
    rank(["q4", "q3", "q2", "q1"]),
  ];
  plan.outputs = ["ttm", "window"].map((node_id) => ({ output_id: `out_${node_id}`, node_id, unit_id: "section" }));
  const validated = validateFinancialPlan(plan);
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  const content = presentFinancialUnit({
    plan: validated.value,
    run_id: "44444444-4444-4444-8444-444444444444",
    unit_id: "section",
    subject_names: { a: "NVIDIA" },
    results: [
      { result_id: "55555555-5555-4555-8555-000000000000", output_id: "out_ttm", node_id: "ttm", disposition: "computed", payload: { kind: "value", value: "90", unit: { kind: "currency", currency: "USD" }, exact: true, rounding: null }, result_hash: "f".repeat(64) },
      { result_id: "55555555-5555-4555-8555-000000000001", output_id: "out_window", node_id: "window", disposition: "computed", payload: ranking(periodRank(rank(["q4", "q3", "q2", "q1"]), [...all].reverse())), result_hash: "f".repeat(64) },
    ],
  });
  const [ttm, window] = content.results.map((result) => content.labels[result.period_label_id]!.text);
  assert.equal(window, "Q1 FY2026 to Q4 FY2026");
  assert.notEqual(ttm, window);
});
