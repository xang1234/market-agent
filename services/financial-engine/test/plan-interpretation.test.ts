import assert from "node:assert/strict";
import test from "node:test";
import { validateFinancialPlan, type FinancialPlanV1 } from "../../financial-core/src/index.ts";
import { interpretPlan } from "../src/plan-interpretation.ts";
import { revenuePlan } from "./db-fixtures.ts";

const LABELS = new Map([["a", "Apple Inc."], ["b", "Microsoft Corp."]]);

function mutate(plan: FinancialPlanV1, change: (draft: any) => void): FinancialPlanV1 {
  const draft = JSON.parse(JSON.stringify(plan));
  change(draft);
  const validated = validateFinancialPlan(draft);
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

test("the interpretation is generated from structure and tracks every material field", () => {
  const plan = revenuePlan({ subjects: ["a", "b"] });
  const base = interpretPlan(plan, LABELS);
  assert.equal(base.generator_version, "plan-interpretation.v1");
  for (const fragment of ["Apple Inc.", "Microsoft Corp.", "2 requested subjects", "revenue (revenue.v1)", "FY 2023", "FY 2022", "as originally reported", "America/New_York"]) {
    assert.ok(base.text.includes(fragment), `${fragment} in ${base.text}`);
  }
  assert.notEqual(interpretPlan(mutate(plan, (draft) => { draft.policies.reporting_basis = "as_restated"; }), LABELS).text, base.text);
  assert.notEqual(interpretPlan(mutate(plan, (draft) => { draft.time.knowledge_cutoff = "2023-06-30T23:59:59.999-04:00"; }), LABELS).text, base.text);
  assert.notEqual(interpretPlan(mutate(plan, (draft) => { draft.subjects.members.reverse(); }), LABELS).text, base.text);
});

test("omitted subjects are disclosed in the interpretation", () => {
  const plan = mutate(revenuePlan(), (draft) => {
    draft.subjects.requested_count = 3;
    draft.subjects.omitted_count = 2;
  });
  assert.match(interpretPlan(plan, LABELS).text, /1 of 3 requested subjects \(2 omitted\)/u);
});
