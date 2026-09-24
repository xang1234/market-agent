import assert from "node:assert/strict";
import test from "node:test";
import type { MarginNode, PeerCompareNode, PlanThreshold, ThresholdNode } from "../src/contracts.ts";
import { margin, type FinancialOperand } from "../src/operations.ts";
import { evaluateComparison, peerCompare, thresholdPredicate, type PredicateOutcome } from "../src/predicates.ts";
import { FY2023, operand } from "./operand-fixtures.ts";

const thresholdNode = (comparison: ThresholdNode["comparison"]): ThresholdNode => ({
  node_id: "check",
  operation: "threshold",
  operation_version: "threshold.v1",
  subject: "value",
  threshold_id: "limit",
  comparison,
});

function limit(value: string, unit: PlanThreshold["unit"] = { kind: "currency", currency: "USD" }): PlanThreshold {
  return { threshold_id: "limit", value, unit, attribution: { kind: "saved_thesis_condition", ref: "thesis:1:v1" } };
}

function outcome(result: PredicateOutcome): boolean {
  assert.ok(result.ok, result.ok ? "" : result.reason_code);
  assert.ok(result.ok && result.payload.kind === "predicate");
  return result.ok && result.payload.kind === "predicate" ? result.payload.outcome : false;
}

function gap(result: PredicateOutcome): [string, string] {
  assert.equal(result.ok, false, "expected a gap");
  return result.ok ? ["", ""] : [result.disposition, result.reason_code];
}

function marginOperand(nodeId: string, slot: "a" | "b" | "c", grossProfit: string, revenue: string, period = FY2023): FinancialOperand {
  const node: MarginNode = { node_id: nodeId, operation: "gross_margin", operation_version: "gross_margin.v1", numerator: "gp", revenue: "rev" };
  const result = margin(node, operand("gp", { slot, metric: "gross_profit", value: grossProfit, ...period }), operand("rev", { slot, metric: "revenue", value: revenue, ...period }));
  assert.ok(result.ok, result.ok ? "" : result.reason_code);
  return (result as { operand: FinancialOperand }).operand;
}

test("comparison operators are exact and total", () => {
  assert.deepEqual(
    (["gt", "gte", "lt", "lte", "eq"] as const).map((comparison) => [-1, 0, 1].map((cmp) => evaluateComparison(cmp as -1 | 0 | 1, comparison))),
    [
      [false, false, true],
      [false, true, true],
      [true, false, false],
      [true, true, false],
      [false, true, false],
    ],
  );
});

test("threshold: exact reported values against attributed thresholds", () => {
  const revenue = operand("value", { metric: "revenue", value: "100.0000000000000000001", ...FY2023 });
  assert.equal(outcome(thresholdPredicate(thresholdNode("gt"), revenue, limit("100"))), true);
  assert.equal(outcome(thresholdPredicate(thresholdNode("eq"), revenue, limit("100"))), false);
  assert.equal(outcome(thresholdPredicate(thresholdNode("lte"), revenue, limit("100.0000000000000000001"))), true);
  const result = thresholdPredicate(thresholdNode("gte"), revenue, limit("100"));
  assert.deepEqual(result.ok && result.payload, { kind: "predicate", predicate: "threshold", comparison: "gte", outcome: true });
});

test("threshold near a display-rounding boundary is decided by exact operands", () => {
  const third = marginOperand("value", "a", "1", "3");
  const displayed = `0.${"3".repeat(50)}`;
  assert.equal(outcome(thresholdPredicate(thresholdNode("gt"), third, limit(displayed, { kind: "ratio" }))), true);
  assert.equal(outcome(thresholdPredicate(thresholdNode("eq"), third, limit(displayed, { kind: "ratio" }))), false);

  const twoThirds = marginOperand("value", "a", "2", "3");
  const displayedTwoThirds = `0.${"6".repeat(49)}7`;
  assert.equal(outcome(thresholdPredicate(thresholdNode("gte"), twoThirds, limit(displayedTwoThirds, { kind: "ratio" }))), false);
});

test("threshold converts percentages exactly and rejects incompatible units", () => {
  const quarter = marginOperand("value", "a", "1", "4");
  assert.equal(outcome(thresholdPredicate(thresholdNode("gte"), quarter, limit("25", { kind: "percent" }))), true);
  assert.equal(outcome(thresholdPredicate(thresholdNode("gt"), quarter, limit("2500", { kind: "basis_points" }))), false);

  const revenue = operand("value", { metric: "revenue", value: "100", ...FY2023 });
  assert.deepEqual(gap(thresholdPredicate(thresholdNode("gt"), revenue, limit("1", { kind: "currency", currency: "EUR" }))), ["incompatible", "incompatible_currency"]);
  assert.deepEqual(gap(thresholdPredicate(thresholdNode("gt"), revenue, limit("1", { kind: "ratio" }))), ["incompatible", "incompatible_unit"]);
  assert.deepEqual(gap(thresholdPredicate(thresholdNode("gt"), quarter, limit("1", { kind: "percentage_points" }))), ["incompatible", "incompatible_unit"]);
});

test("threshold on a rounded value without exact lineage is precision_indeterminate", () => {
  const third = marginOperand("value", "a", "1", "3");
  const withoutLineage: FinancialOperand = { ...third, rational: null };
  assert.deepEqual(gap(thresholdPredicate(thresholdNode("gt"), withoutLineage, limit("0.3", { kind: "ratio" }))), ["unsupported", "precision_indeterminate"]);
});

const rank = (members: string[], direction: PeerCompareNode["direction"] = "highest"): PeerCompareNode => ({
  node_id: "rank",
  operation: "peer_compare",
  operation_version: "peer_compare.v1",
  members,
  direction,
});

test("peer_compare ranks a complete cohort with explicit ties", () => {
  const a = operand("a_rev", { slot: "a", metric: "revenue", value: "30", ...FY2023 });
  const b = operand("b_rev", { slot: "b", metric: "revenue", value: "10", ...FY2023 });
  const c = operand("c_rev", { slot: "c", metric: "revenue", value: "30", ...FY2023 });
  const highest = peerCompare(rank(["a_rev", "b_rev", "c_rev"]), [a, b, c]);
  assert.deepEqual(highest.ok && highest.payload, {
    kind: "ranking",
    direction: "highest",
    population: { requested: 3, evaluated: 3 },
    complete: true,
    ranks: [
      { node_id: "a_rev", rank: 1 },
      { node_id: "b_rev", rank: 3 },
      { node_id: "c_rev", rank: 1 },
    ],
    extreme: ["a_rev", "c_rev"],
  });
  const lowest = peerCompare(rank(["a_rev", "b_rev", "c_rev"], "lowest"), [a, b, c]);
  assert.deepEqual(lowest.ok && lowest.payload.kind === "ranking" && lowest.payload.extreme, ["b_rev"]);
  // Deterministic regardless of member order: leaders are listed by node id.
  const reordered = peerCompare(rank(["c_rev", "b_rev", "a_rev"]), [c, b, a]);
  assert.deepEqual(reordered.ok && reordered.payload.kind === "ranking" && reordered.payload.extreme, ["a_rev", "c_rev"]);
});

test("peer_compare with a missing member withholds the full-cohort superlative", () => {
  const a = operand("a_rev", { slot: "a", metric: "revenue", value: "30", ...FY2023 });
  const c = operand("c_rev", { slot: "c", metric: "revenue", value: "20", ...FY2023 });
  const result = peerCompare(rank(["a_rev", "b_rev", "c_rev"]), [a, null, c]);
  assert.ok(result.ok && result.payload.kind === "ranking");
  if (!result.ok || result.payload.kind !== "ranking") return;
  assert.equal(result.payload.complete, false);
  assert.deepEqual(result.payload.population, { requested: 3, evaluated: 2 });
  assert.equal(result.payload.extreme, null);
  assert.deepEqual(result.payload.ranks, [
    { node_id: "a_rev", rank: 1 },
    { node_id: "c_rev", rank: 2 },
  ]);
  assert.deepEqual(gap(peerCompare(rank(["a_rev", "b_rev"]), [null, null])), ["missing", "missing_input"]);
});

test("peer_compare compares margins through exact ratios, not rounded displays", () => {
  const third = marginOperand("a_gm", "a", "1", "3");
  const almost = marginOperand("b_gm", "b", "333333", "1000000");
  const quarter = marginOperand("c_gm", "c", "2", "8");
  const result = peerCompare(rank(["a_gm", "b_gm", "c_gm"]), [third, almost, quarter]);
  assert.deepEqual(result.ok && result.payload.kind === "ranking" && result.payload.ranks.map((entry) => entry.rank), [1, 2, 3]);

  const quarterAgain = marginOperand("a_gm", "a", "1", "4");
  const tie = peerCompare(rank(["a_gm", "c_gm"]), [quarterAgain, quarter]);
  assert.deepEqual(tie.ok && tie.payload.kind === "ranking" && tie.payload.extreme, ["a_gm", "c_gm"]);
});

test("peer_compare refuses to rank incompatible definitions, periods, currencies, or duplicate subjects", () => {
  const a = operand("a_rev", { slot: "a", metric: "revenue", value: "30", ...FY2023 });
  const fiscal = operand("b_rev", { slot: "b", metric: "revenue", value: "10", start: "2022-10-01", end: "2023-09-30", fiscal_year: 2023, fiscal_period: "FY" });
  assert.deepEqual(gap(peerCompare(rank(["a_rev", "b_rev"]), [a, fiscal])), ["incompatible", "incompatible_period"]);
  const income = operand("b_ni", { slot: "b", metric: "net_income", value: "10", ...FY2023 });
  assert.deepEqual(gap(peerCompare(rank(["a_rev", "b_ni"]), [a, income])), ["incompatible", "incompatible_definition"]);
  const euro = operand("b_rev", { slot: "b", metric: "revenue", value: "10", unit: { kind: "currency", currency: "EUR" }, ...FY2023 });
  assert.deepEqual(gap(peerCompare(rank(["a_rev", "b_rev"]), [a, euro])), ["incompatible", "incompatible_currency"]);
  const again = operand("a_rev2", { slot: "a", metric: "revenue", value: "31", ...FY2023 });
  assert.deepEqual(gap(peerCompare(rank(["a_rev", "a_rev2"]), [a, again])), ["incompatible", "incompatible_scope"]);
});
