import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialPlanV1, ReportedMetricNode } from "../src/contracts.ts";
import { capPopulation, cohortAssertion, evaluatePlan, summarizeCoverage, type GraphEvaluation, type NodeState } from "../src/coverage.ts";
import { FinancialIntegrityError, operandFromBoundInput, operationGap, type OperandOutcome } from "../src/operations.ts";
import { validateFinancialPlan } from "../src/validate.ts";
import { boundInput, FY2023, type InputSpec } from "./operand-fixtures.ts";

const ISSUERS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0",
];
const SLOT_IDS = ["a", "b", "c", "d"];

/** Four-company cohort: per-company unit (revenue, gross margin, >= 40% check) plus a cohort ranking unit. */
function cohortPlan(): FinancialPlanV1 {
  const members = SLOT_IDS.map((slot_id, index) => ({
    slot_id,
    subject_ref: { kind: "issuer" as const, id: ISSUERS[index]! },
    display_order: index,
    role: index === 0 ? ("primary" as const) : ("peer" as const),
  }));
  const reported = (slot: string, metric: string) => ({
    node_id: `${slot}_${metric === "revenue" ? "rev" : "gp"}`,
    operation: "reported_metric" as const,
    operation_version: "reported_metric.v1",
    subject_slot: slot,
    metric_key: metric,
    period: { kind: "fiscal_period" as const, fiscal_year: 2023, fiscal_period: "FY" as const },
  });
  const plan = {
    schema_version: "financial_plan.v1" as const,
    plan_id: "33333333-3333-4333-8333-333333333333",
    origin: { kind: "chat_request" as const, ref: "chat:turn:2" },
    planner: { kind: "deterministic" as const, adapter_version: "test.v1", model: null, prompt_version: null },
    catalog_version: "catalog.v1",
    interpretation: null,
    subjects: { membership: "explicit" as const, requested_count: 4, resolved_count: 4, omitted_count: 0, members },
    time: { knowledge_cutoff: "2024-03-01T23:59:59.999-05:00", cutoff_timezone: "America/New_York", time_mode: "public_information" as const },
    policies: { reporting_basis: "as_reported" as const, period_policy: "exact_fiscal" as const, freshness: { max_age_days: null }, source_policy_version: "sources.v1" },
    metric_definitions: [
      { metric_key: "revenue", definition_version: "revenue.v1" },
      { metric_key: "gross_profit", definition_version: "gross_profit.v1" },
    ],
    operations: [
      ...SLOT_IDS.flatMap((slot) => [reported(slot, "revenue"), reported(slot, "gross_profit")]),
      ...SLOT_IDS.map((slot) => ({ node_id: `${slot}_gm`, operation: "gross_margin" as const, operation_version: "gross_margin.v1", numerator: `${slot}_gp`, revenue: `${slot}_rev` })),
      ...SLOT_IDS.map((slot) => ({ node_id: `${slot}_check`, operation: "threshold" as const, operation_version: "threshold.v1", subject: `${slot}_gm`, threshold_id: "min_gm", comparison: "gte" as const })),
      { node_id: "rank", operation: "peer_compare" as const, operation_version: "peer_compare.v1", members: SLOT_IDS.map((slot) => `${slot}_gm`), direction: "highest" as const },
    ],
    outputs: [
      ...SLOT_IDS.flatMap((slot) => [
        { output_id: `${slot}_out_rev`, node_id: `${slot}_rev`, unit_id: `${slot}_unit` },
        { output_id: `${slot}_out_gm`, node_id: `${slot}_gm`, unit_id: `${slot}_unit` },
        { output_id: `${slot}_out_check`, node_id: `${slot}_check`, unit_id: `${slot}_unit` },
      ]),
      { output_id: "out_rank", node_id: "rank", unit_id: "cohort" },
    ],
    publication_units: [...SLOT_IDS.map((slot) => ({ unit_id: `${slot}_unit`, kind: "chat_section" as const })), { unit_id: "cohort", kind: "chat_section" as const }],
    thresholds: [{ threshold_id: "min_gm", value: "0.4", unit: { kind: "ratio" as const }, attribution: { kind: "user_request" as const, ref: "chat:turn:2" } }],
    limits: { max_subjects: 25, max_periods_per_subject: 20, max_operations: 512, max_outputs: 2000, max_input_candidates: 10000, max_concurrent_evidence_tasks: 4 },
    presentation_template_version: "financial-answer.v1",
  };
  const validated = validateFinancialPlan(plan);
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return plan;
}

type Behavior = { value: string } | "missing" | "database_error" | "integrity" | "crash";

const DEFAULT_VALUES: Record<string, string> = {
  a_rev: "100", a_gp: "50",
  b_rev: "200", b_gp: "60",
  c_rev: "300", c_gp: "150",
  d_rev: "400", d_gp: "100",
};

function reportedEvaluator(plan: FinancialPlanV1, overrides: Record<string, Behavior> = {}) {
  const calls: string[] = [];
  const evaluator = (node: ReportedMetricNode): OperandOutcome => {
    calls.push(node.node_id);
    const behavior = overrides[node.node_id] ?? { value: DEFAULT_VALUES[node.node_id]! };
    if (behavior === "missing") return operationGap("missing_input", "No eligible reported value.");
    if (behavior === "database_error") return operationGap("database_error", "The evidence store was unavailable.");
    if (behavior === "integrity") throw new FinancialIntegrityError("scale_mismatch", "corrupt source");
    if (behavior === "crash") throw new TypeError("bug in adapter");
    const slot = plan.subjects.members.find((member) => member.slot_id === node.subject_slot)!;
    const spec: InputSpec = { metric: node.metric_key, value: behavior.value, ...FY2023 };
    const input = { ...boundInput(spec), subject_ref: slot.subject_ref };
    return operandFromBoundInput(input, node, { slot, definition_version: `${node.metric_key}.v1` });
  };
  return { evaluator, calls };
}

function state(evaluation: GraphEvaluation, outputId: string): NodeState {
  const output = evaluation.outputs.find((entry) => entry.output_id === outputId);
  assert.ok(output, outputId);
  return output!.state;
}

function disposition(evaluation: GraphEvaluation, outputId: string): string {
  const current = state(evaluation, outputId);
  return current.status === "computed" ? "computed" : current.status === "gap" ? `${current.disposition}:${current.reason_code}` : `integrity:${current.code}`;
}

test("every requested output receives a disposition; a complete run is complete", () => {
  const plan = cohortPlan();
  const evaluation = evaluatePlan(plan, reportedEvaluator(plan).evaluator);
  assert.equal(evaluation.outputs.length, plan.outputs.length);
  assert.deepEqual(evaluation.outputs.map((output) => output.output_id), plan.outputs.map((output) => output.output_id));
  assert.deepEqual(summarizeCoverage(evaluation), {
    state: "complete",
    requested: 13,
    computed: 13,
    gaps: 0,
    execution_errors: 0,
    rejected: 0,
    by_disposition: { missing: 0, unsupported: 0, not_applicable: 0, undefined: 0, incompatible: 0, blocked_dependency: 0, execution_error: 0 },
  });
  const rank = state(evaluation, "out_rank");
  assert.ok(rank.status === "computed" && rank.payload.kind === "ranking");
  assert.deepEqual(rank.status === "computed" && rank.payload.kind === "ranking" && rank.payload.extreme, ["a_gm", "c_gm"]);
});

test("one missing company input withholds full-cohort conclusions but keeps independent values", () => {
  const plan = cohortPlan();
  // Every available company passes 25%, so only the missing one could falsify "all".
  plan.thresholds[0]!.value = "0.25";
  const evaluation = evaluatePlan(plan, reportedEvaluator(plan, { d_gp: "missing" }).evaluator);
  assert.equal(disposition(evaluation, "d_out_rev"), "computed");
  assert.equal(disposition(evaluation, "d_out_gm"), "blocked_dependency:blocked_by_dependency");
  assert.equal(disposition(evaluation, "d_out_check"), "blocked_dependency:blocked_by_dependency");
  for (const slot of ["a", "b", "c"]) assert.equal(disposition(evaluation, `${slot}_out_check`), "computed");

  const rank = state(evaluation, "out_rank");
  assert.ok(rank.status === "computed" && rank.payload.kind === "ranking");
  if (rank.status === "computed" && rank.payload.kind === "ranking") {
    assert.equal(rank.payload.complete, false);
    assert.equal(rank.payload.extreme, null);
    assert.deepEqual(rank.payload.population, { requested: 4, evaluated: 3 });
  }
  assert.deepEqual(cohortAssertion(evaluation, SLOT_IDS.map((slot) => `${slot}_out_check`), "all"), { holds: null, reason_code: "incomplete_cohort" });
  // One witness establishes "any" even in an incomplete cohort.
  assert.deepEqual(cohortAssertion(evaluation, SLOT_IDS.map((slot) => `${slot}_out_check`), "any"), { holds: true });
  // One counterexample falsifies "all" even in an incomplete cohort.
  const strict = mutable(plan);
  strict.thresholds[0].value = "0.4";
  const counterexample = evaluatePlan(strict, reportedEvaluator(strict, { d_gp: "missing" }).evaluator);
  assert.deepEqual(cohortAssertion(counterexample, SLOT_IDS.map((slot) => `${slot}_out_check`), "all"), { holds: false });

  const coverage = summarizeCoverage(evaluation);
  assert.equal(coverage.state, "partial");
  assert.equal(coverage.computed, 11);
  assert.equal(coverage.by_disposition.blocked_dependency, 2);
});

test("an independent revenue result survives missing gross profit", () => {
  const plan = cohortPlan();
  const evaluation = evaluatePlan(plan, reportedEvaluator(plan, { a_gp: "missing" }).evaluator);
  assert.equal(disposition(evaluation, "a_out_rev"), "computed");
  assert.equal(disposition(evaluation, "a_out_gm"), "blocked_dependency:blocked_by_dependency");
  assert.equal(evaluation.nodes.get("a_gp")?.status, "gap");
});

test("a database error stays execution_error and is never rewritten as missing", () => {
  const plan = cohortPlan();
  const evaluation = evaluatePlan(plan, reportedEvaluator(plan, { b_rev: "database_error" }).evaluator);
  assert.equal(disposition(evaluation, "b_out_rev"), "execution_error:database_error");
  assert.equal(disposition(evaluation, "b_out_gm"), "blocked_dependency:blocked_by_dependency");
  // A transient failure is not tolerated as a missing cohort member.
  assert.equal(disposition(evaluation, "out_rank"), "blocked_dependency:blocked_by_dependency");
  const coverage = summarizeCoverage(evaluation);
  assert.equal(coverage.execution_errors, 1);
  assert.equal(coverage.by_disposition.missing, 0);
});

test("an isolated integrity failure rejects exactly the units whose closure contains it", () => {
  const plan = cohortPlan();
  const evaluation = evaluatePlan(plan, reportedEvaluator(plan, { c_gp: "integrity" }).evaluator);
  const units = Object.fromEntries(evaluation.units.map((unit) => [unit.unit_id, unit.state]));
  assert.deepEqual(units, { a_unit: "computed", b_unit: "computed", c_unit: "rejected", d_unit: "computed", cohort: "rejected" });
  assert.equal(disposition(evaluation, "c_out_rev"), "computed");
  assert.ok(evaluation.outputs.filter((output) => output.unit_id === "c_unit").every((output) => output.unit_rejected));
  assert.equal(disposition(evaluation, "c_out_gm"), "integrity:scale_mismatch");
  assert.equal(disposition(evaluation, "out_rank"), "integrity:scale_mismatch");
  const coverage = summarizeCoverage(evaluation);
  assert.equal(coverage.rejected, 4);
  assert.equal(coverage.state, "partial");
});

test("arbitrary exceptions are run-fatal, never caught as missing data", () => {
  const plan = cohortPlan();
  assert.throws(() => evaluatePlan(plan, reportedEvaluator(plan, { b_gp: "crash" }).evaluator), TypeError);
});

test("evaluation stops calling evidence after an input is evaluated once", () => {
  const plan = cohortPlan();
  const { evaluator, calls } = reportedEvaluator(plan);
  evaluatePlan(plan, evaluator);
  assert.deepEqual(calls.sort(), Object.keys(DEFAULT_VALUES).sort());
});

test("a complete zero-match screen differs from an answer with zero verified outputs", () => {
  const plan = cohortPlan();
  plan.thresholds[0]!.value = "0.99";
  const screen = mutable(plan);
  screen.outputs = SLOT_IDS.map((slot) => ({ output_id: `${slot}_out_check`, node_id: `${slot}_check`, unit_id: `${slot}_unit` }));
  screen.publication_units = screen.publication_units.filter((unit: { unit_id: string }) => unit.unit_id !== "cohort");
  assert.ok(validateFinancialPlan(screen).ok);
  const noMatches = evaluatePlan(screen, reportedEvaluator(screen).evaluator);
  assert.equal(summarizeCoverage(noMatches).state, "complete");
  assert.deepEqual(cohortAssertion(noMatches, screen.outputs.map((output: { output_id: string }) => output.output_id), "any"), { holds: false });
  assert.deepEqual(cohortAssertion(noMatches, screen.outputs.map((output: { output_id: string }) => output.output_id), "all"), { holds: false });

  const everythingMissing = Object.fromEntries(Object.keys(DEFAULT_VALUES).map((node) => [node, "missing" as const]));
  const empty = evaluatePlan(plan, reportedEvaluator(plan, everythingMissing).evaluator);
  const coverage = summarizeCoverage(empty);
  assert.equal(coverage.state, "none");
  assert.equal(coverage.computed, 0);
  assert.equal(coverage.requested, 13);
});

test("population caps disclose truncation explicitly", () => {
  assert.deepEqual(capPopulation(["a", "b", "c"], 5), { items: ["a", "b", "c"], omitted_count: 0, truncated: false });
  assert.deepEqual(capPopulation(["a", "b", "c"], 2), { items: ["a", "b"], omitted_count: 1, truncated: true });
  assert.throws(() => capPopulation(["a"], 0), RangeError);
});

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}
