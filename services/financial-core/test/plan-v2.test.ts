// financial_plan.v2 (#201): v1 plus exactly three attributed P/E assumptions,
// each read by exactly one scenario_eps_multiple node. A v1 plan can carry
// neither.

import assert from "node:assert/strict";
import test from "node:test";
import planSchema from "../../../spec/financial_plan_schema.json" with { type: "json" };
import { planSemanticHash } from "../src/canonical.ts";
import { validateFinancialPlan, type ValidationResult } from "../src/validate.ts";
import { mutable, planFixture, scenarioPlanFixture } from "./fixtures.ts";

function issues(result: ValidationResult<unknown>): string[] {
  assert.equal(result.ok, false, "expected validation to fail");
  return result.ok ? [] : result.issues.map((issue) => `${issue.code} ${issue.path}`);
}

const withAssumption = (index: number, edit: (assumption: any) => void) => {
  const plan = mutable(scenarioPlanFixture());
  edit(plan.assumptions[index]);
  return plan;
};

test("a scenario plan validates as v2, deep-frozen", () => {
  const result = validateFinancialPlan(scenarioPlanFixture());
  assert.ok(result.ok, JSON.stringify(!result.ok && result.issues));
  assert.equal(result.value.schema_version, "financial_plan.v2");
  assert.deepEqual(result.value.assumptions?.map((assumption) => [assumption.scenario, assumption.value]), [["bear", "20"], ["base", "25"], ["bull", "30"]]);
  assert.ok(Object.isFrozen(result.value.assumptions![2].attribution));
});

test("a v1 plan carries neither assumptions nor a scenario node", () => {
  const { assumptions, ...v2 } = scenarioPlanFixture();
  assert.deepEqual(issues(validateFinancialPlan({ ...planFixture(), assumptions })), ["unknown_field $.assumptions"]);
  const scenarioNodeInV1 = issues(validateFinancialPlan({ ...v2, schema_version: "financial_plan.v1" }));
  assert.deepEqual([...new Set(scenarioNodeInV1.map((issue) => issue.split(" ")[1]))], ["$.operations.1"]);
  assert.deepEqual(issues(validateFinancialPlan({ ...scenarioPlanFixture(), schema_version: "financial_plan.v3" })), ["unknown_field $.assumptions"]);
});

test("a multiple is a canonical positive decimal", () => {
  for (const value of ["0", "-20", "20.0", "2e1", "020", " 20", "20x", "1".repeat(33)]) {
    assert.equal(validateFinancialPlan(withAssumption(1, (assumption) => { assumption.value = value; })).ok, false, value);
  }
  for (const value of ["17.5", "0.5", "1".repeat(32)]) {
    assert.equal(validateFinancialPlan(withAssumption(1, (assumption) => { assumption.value = value; })).ok, true, value);
  }
  assert.deepEqual(issues(validateFinancialPlan(withAssumption(1, (assumption) => { assumption.value = 25; }))), ["schema_type $.assumptions.1.value"]);
});

test("bear, base, and bull are each stated once, in that order", () => {
  const plan = mutable(scenarioPlanFixture());
  assert.deepEqual(issues(validateFinancialPlan({ ...plan, assumptions: plan.assumptions.slice(0, 2) })), ["schema_minItems $.assumptions"]);
  assert.deepEqual(issues(validateFinancialPlan({ ...plan, assumptions: [plan.assumptions[1], plan.assumptions[0], plan.assumptions[2]] })), ["schema_const $.assumptions.0.scenario"]);
  assert.deepEqual(issues(validateFinancialPlan({ ...plan, assumptions: [...plan.assumptions, plan.assumptions[2]] })), ["schema_items $.assumptions"]);
  const { assumptions: _assumptions, ...missing } = plan;
  assert.deepEqual(issues(validateFinancialPlan(missing)), ["schema_required $"]);
});

test("every assumption is attributed to the request that stated it", () => {
  assert.deepEqual(issues(validateFinancialPlan(withAssumption(0, (assumption) => { delete assumption.attribution; }))), ["schema_required $.assumptions.0"]);
  assert.deepEqual(issues(validateFinancialPlan(withAssumption(0, (assumption) => { assumption.attribution.kind = "saved_thesis_condition"; }))), ["schema_const $.assumptions.0.attribution.kind"]);
  assert.deepEqual(issues(validateFinancialPlan(withAssumption(0, (assumption) => { assumption.attribution.ref = ""; }))), ["schema_minLength $.assumptions.0.attribution.ref"]);
  assert.deepEqual(issues(validateFinancialPlan(withAssumption(0, (assumption) => { assumption.attribution.captured_at = "2024-02-30T10:00:00Z"; }))), ["invalid_captured_at $.assumptions[0].attribution.captured_at"]);
  // Captured when the user stated it, which may be after a historical cutoff.
  assert.equal(validateFinancialPlan(withAssumption(0, (assumption) => { assumption.attribution.captured_at = "2030-01-01T00:00:00Z"; })).ok, true);
});

test("each assumption is read by exactly one scenario node, and each node reads a declared one", () => {
  const unknown = mutable(scenarioPlanFixture());
  unknown.operations[1].assumption_id = "pe_other";
  assert.deepEqual(issues(validateFinancialPlan(unknown)), ["unused_assumption $.assumptions[0]", "unknown_assumption $.operations[1].assumption_id"]);
  const shared = mutable(scenarioPlanFixture());
  shared.operations[3].assumption_id = "pe_base";
  assert.deepEqual(issues(validateFinancialPlan(shared)), ["shared_assumption $.assumptions[1]", "unused_assumption $.assumptions[2]"]);
  const unread = mutable(scenarioPlanFixture());
  unread.operations.pop();
  unread.outputs.pop();
  assert.deepEqual(issues(validateFinancialPlan(unread)), ["unused_assumption $.assumptions[2]"]);
  const duplicate = mutable(scenarioPlanFixture());
  duplicate.assumptions[2].assumption_id = "pe_base";
  duplicate.operations[3].assumption_id = "pe_base";
  assert.deepEqual(issues(validateFinancialPlan(duplicate)), ["duplicate_assumption_id $.assumptions", "shared_assumption $.assumptions[1]", "shared_assumption $.assumptions[2]"]);
});

test("an assumption's value and attribution are part of the plan's identity; its plan id is not", () => {
  const hash = planSemanticHash(scenarioPlanFixture());
  assert.notEqual(planSemanticHash(scenarioPlanFixture({ bear: "20", base: "22", bull: "30" })), hash);
  assert.notEqual(planSemanticHash(withAssumption(1, (assumption) => { assumption.attribution.ref = "chat:turn:2"; })), hash);
  assert.notEqual(planSemanticHash(withAssumption(1, (assumption) => { assumption.attribution.captured_at = "2024-01-15T15:00:01.000Z"; })), hash);
  assert.equal(planSemanticHash({ ...scenarioPlanFixture(), plan_id: "99999999-9999-4999-8999-999999999999" }), hash);
});

test("the v2 schema is the v1 schema plus assumptions and scenario nodes", () => {
  const defs = (planSchema as { $defs: Record<string, any> }).$defs;
  const v1 = defs.FinancialPlanV1;
  const v2 = defs.FinancialPlanV2;
  assert.deepEqual(v2.required, [...v1.required, "assumptions"]);
  assert.deepEqual(Object.keys(v2.properties), [...Object.keys(v1.properties), "assumptions"]);
  for (const key of Object.keys(v1.properties)) {
    if (key === "schema_version" || key === "operations") continue;
    assert.deepEqual(v2.properties[key], v1.properties[key], key);
  }
  assert.deepEqual(v2.properties.operations, { ...v1.properties.operations, items: { $ref: "#/$defs/OperationNodeV2" } });
  assert.deepEqual(defs.OperationNodeV2.oneOf, [{ $ref: "#/$defs/OperationNode" }, { $ref: "#/$defs/ScenarioEpsMultipleNode" }]);
  assert.deepEqual([v1.properties.schema_version.const, v2.properties.schema_version.const], ["financial_plan.v1", "financial_plan.v2"]);
});
