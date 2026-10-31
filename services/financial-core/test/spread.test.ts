import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialPlanV1, MarginNode, SpreadNode } from "../src/contracts.ts";
import { evaluatePlan } from "../src/coverage.ts";
import { margin, operationGap, spread, type FinancialOperand, type OperandOutcome } from "../src/operations.ts";
import { presentFinancialUnit } from "../src/presentation.ts";
import { validateFinancialPlan } from "../src/validate.ts";
import { change, planFixture } from "./fixtures.ts";
import { FY2023, operand, SLOTS } from "./operand-fixtures.ts";

const SPREAD: SpreadNode = { node_id: "lead", operation: "spread", operation_version: "spread.v1", left: "a_gm", right: "b_gm" };

const NVDA_Q4 = { start: "2025-10-27", end: "2026-01-25", fiscal_year: 2026, fiscal_period: "Q4" as const };
const AMD_Q4 = { start: "2025-09-28", end: "2025-12-27", fiscal_year: 2025, fiscal_period: "Q4" as const };

type Period = { start: string; end: string; fiscal_year: number; fiscal_period: "FY" | "Q1" | "Q2" | "Q3" | "Q4" };

function grossMargin(nodeId: string, slot: "a" | "b", grossProfit: string, revenue: string, period: Period): FinancialOperand {
  const node: MarginNode = { node_id: nodeId, operation: "gross_margin", operation_version: "gross_margin.v1", numerator: "gp", revenue: "rev" };
  const result = margin(node, operand("gp", { slot, metric: "gross_profit", value: grossProfit, ...period }), operand("rev", { slot, metric: "revenue", value: revenue, ...period }));
  assert.ok(result.ok, result.ok ? "" : result.reason_code);
  return (result as { operand: FinancialOperand }).operand;
}

function value(outcome: OperandOutcome) {
  assert.ok(outcome.ok, outcome.ok ? "" : `${outcome.reason_code}: ${outcome.explanation}`);
  return outcome.ok ? outcome.payload : null;
}

function gap(outcome: OperandOutcome): [string, string] {
  assert.equal(outcome.ok, false, "expected a gap");
  return outcome.ok ? ["", ""] : [outcome.disposition, outcome.reason_code];
}

test("a margin lead across fiscal calendars is left minus right, in percentage points", () => {
  const nvda = grossMargin("a_gm", "a", "744", "1000", NVDA_Q4);
  const amd = grossMargin("b_gm", "b", "328", "1000", AMD_Q4);
  assert.deepEqual(value(spread(SPREAD, nvda, amd)), { kind: "value", value: "41.6", unit: { kind: "percentage_points" }, exact: true, rounding: null });
  assert.deepEqual(value(spread(SPREAD, amd, nvda)), { kind: "value", value: "-41.6", unit: { kind: "percentage_points" }, exact: true, rounding: null }, "the primary trails: a negative lead");
  const level = grossMargin("b_gm", "b", "372", "500", AMD_Q4);
  assert.deepEqual(value(spread(SPREAD, nvda, level)), { kind: "value", value: "0", unit: { kind: "percentage_points" }, exact: true, rounding: null }, "equal margins tie at a real zero");
});

test("a lead in currency stays in that currency", () => {
  const nvda = operand("a_rev", { slot: "a", metric: "revenue", value: "62100", ...NVDA_Q4 });
  const amd = operand("b_rev", { slot: "b", metric: "revenue", value: "10300", ...AMD_Q4 });
  assert.deepEqual(value(spread(SPREAD, nvda, amd)), { kind: "value", value: "51800", unit: { kind: "currency", currency: "USD" }, exact: true, rounding: null });
});

test("a spread is between two subjects on one measure, in periods of one length that end close together", () => {
  const nvda = grossMargin("a_gm", "a", "744", "1000", NVDA_Q4);
  assert.deepEqual(gap(spread(SPREAD, nvda, grossMargin("b_gm", "a", "328", "1000", AMD_Q4))), ["incompatible", "incompatible_scope"], "the same subject");
  assert.deepEqual(gap(spread(SPREAD, nvda, operand("b_rev", { slot: "b", metric: "revenue", value: "10300", ...AMD_Q4 }))), ["incompatible", "incompatible_definition"], "another measure");
  assert.deepEqual(gap(spread(SPREAD, nvda, grossMargin("b_gm", "b", "328", "1000", { ...FY2023, start: "2025-01-01", end: "2025-12-31", fiscal_year: 2025 }))), ["incompatible", "incompatible_period"], "a quarter against a year");
  const euro = operand("b_rev", { slot: "b", metric: "revenue", value: "10300", unit: { kind: "currency", currency: "EUR" }, ...AMD_Q4 });
  assert.deepEqual(gap(spread(SPREAD, operand("a_rev", { slot: "a", metric: "revenue", value: "62100", ...NVDA_Q4 }), euro)), ["incompatible", "incompatible_currency"]);
});

test("two quarters pair only while their ends lie within half a quarter of each other", () => {
  const left = grossMargin("a_gm", "a", "744", "1000", { start: "2025-10-01", end: "2025-12-30", fiscal_year: 2025, fiscal_period: "Q4" });
  const endingOn = (start: string, end: string) => grossMargin("b_gm", "b", "328", "1000", { start, end, fiscal_year: 2026, fiscal_period: "Q1" });
  assert.equal(value(spread(SPREAD, left, endingOn("2025-11-15", "2026-02-13")))?.value, "41.6", "45 days apart");
  assert.deepEqual(gap(spread(SPREAD, left, endingOn("2025-11-16", "2026-02-14"))), ["incompatible", "incompatible_period"], "46 days apart");
  assert.equal(value(spread(SPREAD, left, endingOn("2025-08-17", "2025-11-15")))?.value, "41.6", "45 days apart, the right first");
});

test("a spread of multiples has no percentage points", () => {
  const ratio = (nodeId: string, slot: "a" | "b") => ({
    ...operand(nodeId, { slot, metric: "revenue", value: "2", ...NVDA_Q4 }),
    measure: { metric_key: "pe_ratio", definition_version: "pe_ratio.v1", derivations: [] },
    measurement: { unit: { kind: "ratio" as const }, dimensions: { scope: "consolidated" as const, members: [] }, basis: { reporting: "as_reported" as const, adjustment: "unadjusted" as const, share_basis: "not_applicable" as const } },
  });
  assert.deepEqual(gap(spread(SPREAD, ratio("a_pe", "a"), ratio("b_pe", "b"))), ["unsupported", "unsupported_operation"]);
});

function leadPlan(): FinancialPlanV1 {
  const fixture = planFixture();
  const validated = validateFinancialPlan({
    ...fixture,
    operations: [...fixture.operations.filter((node) => node.operation !== "threshold" && node.operation !== "peer_compare"), SPREAD],
    outputs: [
      { output_id: "out_a_gm", node_id: "a_gm", unit_id: "section" },
      { output_id: "out_b_gm", node_id: "b_gm", unit_id: "section" },
      { output_id: "out_lead", node_id: "lead", unit_id: "section" },
    ],
    thresholds: [],
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

test("a spread whose operand is a gap is blocked, never zero", () => {
  const plan = leadPlan();
  const quarter = (node: { node_id: string }) => (node.node_id.startsWith("a") ? NVDA_Q4 : AMD_Q4);
  const evaluation = evaluatePlan(plan, (node) => {
    if (node.node_id === "b_gp") return operationGap("missing_input", "No eligible input.");
    const result = operand(node.node_id, { slot: node.subject_slot as "a" | "b", metric: node.metric_key, value: node.metric_key === "revenue" ? "1000" : "744", ...quarter(node) });
    return { ok: true, operand: result, payload: { kind: "value", value: "0", unit: result.measurement.unit, exact: true, rounding: null } };
  });
  assert.deepEqual(evaluation.outputs.map((output) => [output.output_id, output.state.status, output.state.status === "gap" ? output.state.reason_code : null]), [
    ["out_a_gm", "computed", null],
    ["out_b_gm", "gap", "blocked_by_dependency"],
    ["out_lead", "gap", "blocked_by_dependency"],
  ]);
});

test("the presentation names each side's company and period, and reads the lead in points", () => {
  const plan = leadPlan();
  const content = presentFinancialUnit({
    plan,
    run_id: "44444444-4444-4444-8444-444444444444",
    unit_id: "section",
    subject_names: { a: "NVIDIA", b: "AMD" },
    results: plan.outputs.map((output, index) => ({
      result_id: `55555555-5555-4555-8555-00000000000${index}`,
      output_id: output.output_id,
      node_id: output.node_id,
      disposition: "computed",
      payload: { kind: "value", value: ["0.744", "0.328", "41.6"][index], unit: { kind: index === 2 ? "percentage_points" : "ratio" }, exact: true, rounding: null },
      result_hash: "f".repeat(64),
    })),
  });
  const lead = content.results[2]!;
  assert.deepEqual(
    [lead.subject_label_id, content.labels[lead.measure_label_id]!.text, content.labels[lead.period_label_id]!.text, lead.presented.kind === "value" && lead.presented.text],
    [null, "Difference in Gross margin (gross profit / revenue)", "NVIDIA FY2023 minus AMD FY2023", "41.60 pp"],
  );
  assert.deepEqual(content.presentations.map((presentation) => presentation.kind), ["table", "scalar"], "the lead stands beside the companies' table");
});

test("a lead is never another operation's operand: it is one company's figure minus another's", () => {
  const fixture = planFixture();
  const gm = (slot: string) => ({ node_id: `${slot}_gm`, operation: "gross_margin" as const, operation_version: "gross_margin.v1", numerator: `${slot}_gp`, revenue: `${slot}_rev` });
  const lead = (left: string, right: string) => ({ node_id: `${left}_minus_${right}`, operation: "spread" as const, operation_version: "spread.v1", left: `${left}_gm`, right: `${right}_gm` });
  const reported = (slot: string, metric_key: string) => ({ ...fixture.operations[0]!, node_id: `${slot}_${metric_key === "revenue" ? "rev" : "gp"}`, subject_slot: slot, metric_key });
  const validated = validateFinancialPlan({
    ...fixture,
    subjects: { ...fixture.subjects, requested_count: 3, resolved_count: 3, members: [...fixture.subjects.members, { slot_id: "c", subject_ref: SLOTS.c.subject_ref, display_order: 2, role: "peer" }] },
    operations: [
      ...["a", "b", "c"].flatMap((slot) => [reported(slot, "revenue"), reported(slot, "gross_profit"), gm(slot)]),
      lead("a", "b"),
      lead("a", "c"),
      lead("c", "a"),
      change("change", "absolute_change", "a_minus_c", "a_minus_b"),
      { node_id: "lead_of_leads", operation: "spread", operation_version: "spread.v1", left: "a_minus_b", right: "c_minus_a" },
      { node_id: "cohort", operation: "peer_compare", operation_version: "peer_compare.v1", members: ["a_minus_b", "c_minus_a"], direction: "highest" },
      { node_id: "check", operation: "threshold", operation_version: "threshold.v1", subject: "a_minus_b", threshold_id: "min_gm", comparison: "gte" },
    ],
    outputs: ["a_minus_b", "change", "lead_of_leads", "cohort", "check"].map((node_id) => ({ output_id: `out_${node_id}`, node_id, unit_id: "section" })),
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  const GROSS: Record<string, string> = { a: "744", b: "328", c: "470" };
  const evaluation = evaluatePlan(validated.value, (node) => {
    const slot = node.subject_slot as "a" | "b" | "c";
    const result = operand(node.node_id, { slot, metric: node.metric_key, value: node.metric_key === "revenue" ? "1000" : GROSS[slot]!, ...FY2023 });
    return { ok: true, operand: result, payload: { kind: "value", value: "0", unit: result.measurement.unit, exact: true, rounding: null } };
  });
  assert.deepEqual(evaluation.outputs.map((output) => [output.output_id, output.state.status, output.state.status === "gap" ? output.state.reason_code : null]), [
    ["out_a_minus_b", "computed", null],
    ["out_change", "gap", "incompatible_scope"],
    ["out_lead_of_leads", "gap", "incompatible_scope"],
    ["out_cohort", "gap", "incompatible_scope"],
    ["out_check", "gap", "incompatible_scope"],
  ]);
});
