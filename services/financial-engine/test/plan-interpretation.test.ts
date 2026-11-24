import assert from "node:assert/strict";
import test from "node:test";
import { validateFinancialPlan, type FinancialPlan } from "../../financial-core/src/index.ts";
import { interpretPlan } from "../src/plan-interpretation.ts";
import { revenuePlan } from "./db-fixtures.ts";

const LABELS = new Map([["a", "Apple Inc."], ["b", "Microsoft Corp."]]);

function mutate(plan: FinancialPlan, change: (draft: any) => void): FinancialPlan {
  const draft = JSON.parse(JSON.stringify(plan));
  change(draft);
  const validated = validateFinancialPlan(draft);
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

test("the interpretation is generated from structure and tracks every material field", () => {
  const plan = revenuePlan({ subjects: ["a", "b"] });
  const base = interpretPlan(plan, LABELS);
  assert.equal(base.generator_version, "plan-interpretation.v2");
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

// Before any fact binds, the plan cannot know whether capex is filed as PP&E or as productive assets, nor OCF in total
// or for continuing operations, so its interpretation names neither (#744).
test("free cash flow is interpreted without the scope only a bound fact can tell", () => {
  const plan = mutate(revenuePlan(), (draft) => {
    const reported = (node_id: string, metric_key: string) => ({ node_id, operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key, period: { kind: "fiscal_period", fiscal_year: 2023, fiscal_period: "FY" } });
    draft.metric_definitions = [{ metric_key: "operating_cash_flow", definition_version: "operating_cash_flow.v1" }, { metric_key: "capex", definition_version: "capex.v1" }];
    draft.operations = [reported("ocf", "operating_cash_flow"), reported("capex", "capex"), { node_id: "fcf", operation: "free_cash_flow", operation_version: "free_cash_flow.v1", operating_cash_flow: "ocf", capex: "capex" }];
    draft.outputs = [{ output_id: "out_fcf", node_id: "fcf", unit_id: draft.publication_units[0].unit_id }];
    draft.thresholds = [];
  });
  const { generator_version, text } = interpretPlan(plan, LABELS);
  assert.equal(generator_version, "plan-interpretation.v2");
  assert.match(text, /Calculations: free cash flow \(operating cash flow less capital expenditures\)\./u);
  assert.doesNotMatch(text, /PP&E|productive|continuing/u);
});
