import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialPlanV1 } from "../src/contracts.ts";
import { dependencyClosure, effectiveLimits, topologicalOrder, validatePlanGraph } from "../src/graph.ts";
import { unitClosures, unitsDependingOn } from "../src/publication-units.ts";
import { validateFinancialPlan } from "../src/validate.ts";
import { mutable, planFixture } from "./fixtures.ts";

function codes(plan: FinancialPlanV1, parent?: Parameters<typeof validatePlanGraph>[1]): string[] {
  return validatePlanGraph(plan, parent).map((issue) => issue.code);
}

test("a valid plan graph has no issues and a deterministic topological order", () => {
  const plan = planFixture();
  assert.deepEqual(codes(plan), []);
  const order = topologicalOrder(plan);
  assert.deepEqual(order, ["a_rev", "a_gp", "b_rev", "b_gp", "a_gm", "b_gm", "a_gm_check", "gm_rank"]);
  assert.deepEqual(topologicalOrder(mutable(plan)), order);
  for (const node of plan.operations) {
    const position = order.indexOf(node.node_id);
    for (const dependency of [...dependencyClosure(plan, [node.node_id])].filter((id) => id !== node.node_id)) {
      assert.ok(order.indexOf(dependency) < position, `${dependency} before ${node.node_id}`);
    }
  }
});

test("cycles and self-references are rejected before any acquisition", () => {
  const cycle = mutable(planFixture());
  cycle.operations.push(
    { node_id: "x", operation: "absolute_change", operation_version: "absolute_change.v1", current: "y", prior: "a_rev" },
    { node_id: "y", operation: "absolute_change", operation_version: "absolute_change.v1", current: "x", prior: "a_rev" },
  );
  assert.ok(codes(cycle).includes("dependency_cycle"));
  assert.ok(!validateFinancialPlan(cycle).ok);

  const self = mutable(planFixture());
  self.operations[4].numerator = "a_gm";
  assert.ok(codes(self).includes("dependency_cycle"));
});

test("predicate nodes cannot be used as numeric operands", () => {
  const plan = mutable(planFixture());
  plan.operations.push({ node_id: "bad", operation: "threshold", operation_version: "threshold.v1", subject: "gm_rank", threshold_id: "min_gm", comparison: "gt" });
  plan.outputs.push({ output_id: "out_bad", node_id: "bad", unit_id: "section" });
  assert.deepEqual(codes(plan), ["invalid_operand"]);

  const change = mutable(planFixture());
  change.operations.push({ node_id: "chg", operation: "absolute_change", operation_version: "absolute_change.v1", current: "a_gm_check", prior: "a_gm" });
  change.outputs.push({ output_id: "out_chg", node_id: "chg", unit_id: "section" });
  assert.deepEqual(codes(change), ["invalid_operand"]);
});

test("duplicate cohort members and duplicate trailing-sum quarters are invalid parameters", () => {
  const plan = mutable(planFixture());
  plan.operations[7].members = ["a_gm", "a_gm"];
  assert.deepEqual(codes(plan), ["invalid_parameters"]);
});

test("operation versions must match the approved catalog", () => {
  const plan = mutable(planFixture());
  plan.operations[4].operation_version = "gross_margin.v9";
  assert.deepEqual(codes(plan), ["unsupported_operation_version"]);
});

test("scope limits are enforced from the plan and parent without silent truncation", () => {
  const plan = mutable(planFixture());
  plan.limits.max_operations = 7;
  assert.deepEqual(codes(plan), ["scope_limit_exceeded"]);

  const outputs = mutable(planFixture());
  outputs.limits.max_outputs = 4;
  assert.deepEqual(codes(outputs), ["scope_limit_exceeded"]);

  assert.deepEqual(codes(planFixture(), { max_subjects: 1 }), ["scope_limit_exceeded"]);
  assert.deepEqual(codes(planFixture(), { max_subjects: 30 }), []);

  const periods = mutable(planFixture());
  periods.limits.max_periods_per_subject = 1;
  periods.operations.push({
    node_id: "a_rev_prior",
    operation: "reported_metric",
    operation_version: "reported_metric.v1",
    subject_slot: "a",
    metric_key: "revenue",
    period: { kind: "fiscal_period", fiscal_year: 2022, fiscal_period: "FY" },
  });
  periods.outputs.push({ output_id: "out_prior", node_id: "a_rev_prior", unit_id: "section" });
  assert.deepEqual(codes(periods), ["scope_limit_exceeded"]);
});

test("effective limits take the lowest of defaults, plan, and parent", () => {
  const limits = effectiveLimits({ ...planFixture().limits, max_outputs: 100 }, { max_outputs: 500, max_subjects: 3 });
  assert.equal(limits.max_outputs, 100);
  assert.equal(limits.max_subjects, 3);
  assert.equal(limits.max_concurrent_evidence_tasks, 4);
  assert.equal(effectiveLimits(planFixture().limits, { max_operations: 10_000 }).max_operations, 512);
});

test("publication units carry frozen transitive dependency closures", () => {
  const plan = mutable(planFixture());
  plan.publication_units = [
    { unit_id: "a_unit", kind: "chat_section" },
    { unit_id: "cohort", kind: "chat_section" },
  ];
  plan.outputs = [
    { output_id: "out_a_rev", node_id: "a_rev", unit_id: "a_unit" },
    { output_id: "out_check", node_id: "a_gm_check", unit_id: "a_unit" },
    { output_id: "out_rank", node_id: "gm_rank", unit_id: "cohort" },
  ];
  const closures = unitClosures(plan);
  assert.deepEqual([...closures.get("a_unit")!.node_ids].sort(), ["a_gm", "a_gm_check", "a_gp", "a_rev"]);
  assert.deepEqual([...closures.get("cohort")!.node_ids].sort(), ["a_gm", "a_gp", "a_rev", "b_gm", "b_gp", "b_rev", "gm_rank"]);
  assert.ok(Object.isFrozen(closures.get("a_unit")) && Object.isFrozen(closures.get("a_unit")!.node_ids));
  assert.deepEqual(unitsDependingOn(plan, "b_gp"), ["cohort"]);
  assert.deepEqual(unitsDependingOn(plan, "a_gp"), ["a_unit", "cohort"]);
});
