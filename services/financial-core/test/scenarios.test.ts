// P/E scenarios (#201): reported annual diluted EPS times a bear, base, and
// bull P/E the user supplied, exactly, in the EPS currency per share.

import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonical } from "../src/canonical.ts";
import type { BoundFinancialInputV1, FinancialPlan, LocalId, PeriodSelector, ReasonCode } from "../src/contracts.ts";
import { evaluateBoundPlan, nodeLineageHashes, unitPublication, type ExpectedResult, type SlotBinding } from "../src/bound-evaluation.ts";
import { scenarioEpsMultiple } from "../src/operations.ts";
import { validateFinancialPlan } from "../src/validate.ts";
import { mutable, scenarioPlanFixture, type Multiples } from "./fixtures.ts";
import { boundInput, operand } from "./operand-fixtures.ts";

const DIGEST = "c".repeat(64);
const FY2023 = { start: "2023-01-01", end: "2023-12-31", fiscal_year: 2023, fiscal_period: "FY" as const };

function draftPlan(multiples?: Multiples, period?: PeriodSelector, metric = "eps_diluted") {
  const plan = mutable(scenarioPlanFixture(multiples, period));
  plan.metric_definitions = [{ metric_key: metric, definition_version: `${metric}.v1` }];
  plan.operations[0].metric_key = metric;
  return plan;
}

function scenarioPlan(multiples?: Multiples, period?: PeriodSelector): FinancialPlan {
  const validated = validateFinancialPlan(draftPlan(multiples, period));
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

const issues = (plan: unknown) => {
  const validated = validateFinancialPlan(plan);
  return validated.ok ? [] : validated.issues.map((issue) => `${issue.code} ${issue.path}`);
};
const EARNINGS_ISSUES = ["invalid_scenario_earnings $.operations[1].earnings", "invalid_scenario_earnings $.operations[2].earnings", "invalid_scenario_earnings $.operations[3].earnings"];

const eps = (value: string, overrides: { metric?: string; fiscal_period?: "FY" | "Q4"; start?: string } = {}): BoundFinancialInputV1 => boundInput({
  metric: overrides.metric ?? "eps_diluted", value, unit: { kind: "currency_per_share", currency: "USD" }, ...FY2023,
  fiscal_period: overrides.fiscal_period ?? "FY", start: overrides.start ?? FY2023.start, share_basis: overrides.metric === "eps_basic" ? "basic" : "diluted",
});

function publish(input: BoundFinancialInputV1 | ReasonCode, plan = scenarioPlan()): Record<string, ExpectedResult> {
  const binding: SlotBinding = typeof input === "string"
    ? { status: "gap", reason_code: input, candidate_set_digest: DIGEST }
    : { status: "bound", input, payload_hash: hashCanonical("bound_input", input), candidate_set_digest: DIGEST };
  const bindings = new Map<LocalId, SlotBinding>([["eps", binding]]);
  const evaluation = evaluateBoundPlan(plan, bindings);
  const publication = unitPublication(plan, evaluation, nodeLineageHashes(plan, evaluation, bindings), "section");
  return Object.fromEntries(publication.results.map((result) => [result.node_id, result]));
}

const shown = (results: Record<string, ExpectedResult>) =>
  ["eps", "bear", "base", "bull"].map((node) => {
    const { disposition, payload } = results[node]!;
    return payload.kind === "value" ? [disposition, payload.value] : [disposition, payload.kind === "gap" ? payload.reason_code : payload.kind];
  });

test("diluted EPS of 4 at 20x, 25x, and 30x is 80, 100, and 120 per share, exactly, in EPS's currency", () => {
  const results = publish(eps("4"));
  assert.deepEqual(shown(results), [["computed", "4"], ["computed", "80"], ["computed", "100"], ["computed", "120"]]);
  assert.deepEqual(results.base!.payload, { kind: "value", value: "100", unit: { kind: "currency_per_share", currency: "USD" }, exact: true, rounding: null });
  assert.deepEqual(results.base!.dependencies, ["eps"]);
});

test("a fractional EPS and multiple multiply exactly: 1.23 × 17.5 is 21.525", () => {
  const plan = scenarioPlan({ bear: "17.5", base: "0.5", bull: "333.333333333333333333333333" });
  assert.deepEqual(shown(publish(eps("1.23"), plan)), [
    ["computed", "1.23"], ["computed", "21.525"], ["computed", "0.615"], ["computed", "409.99999999999999999999999959"],
  ]);
});

test("zero or negative EPS is not applicable to a P/E scenario", () => {
  for (const value of ["0", "-1", "-0.01"]) {
    assert.deepEqual(shown(publish(eps(value))).slice(1), Array(3).fill(["not_applicable", "non_positive_base"]), value);
  }
  const negative = publish(eps("-1")).bear!.payload;
  assert.ok(negative.kind === "gap" && /zero or negative/u.test(negative.explanation));
});

test("a plan whose scenario reads basic EPS, a quarter, or a year before the latest is invalid", () => {
  assert.deepEqual(issues(draftPlan(undefined, undefined, "eps_basic")), EARNINGS_ISSUES);
  assert.deepEqual(issues(draftPlan(undefined, { kind: "fiscal_period", fiscal_year: 2023, fiscal_period: "Q4" })), EARNINGS_ISSUES);
  assert.deepEqual(issues(draftPlan(undefined, { kind: "latest", period_type: "annual", offset: 1 })), EARNINGS_ISSUES);
  assert.deepEqual(issues(draftPlan(undefined, { kind: "latest", period_type: "quarterly", offset: 0 })), EARNINGS_ISSUES);
  assert.deepEqual(issues(draftPlan(undefined, { kind: "latest", period_type: "annual", offset: 0 })), []);
});

test("a latest fiscal year bound to a quarter is no scenario value", () => {
  const latest = scenarioPlan(undefined, { kind: "latest", period_type: "annual", offset: 0 });
  assert.deepEqual(shown(publish(eps("4"), latest)).slice(1), [["computed", "80"], ["computed", "100"], ["computed", "120"]]);
  assert.deepEqual(shown(publish(eps("1", { fiscal_period: "Q4", start: "2023-10-01" }), latest)).slice(1), Array(3).fill(["unsupported", "unsupported_period"]));
});

test("a missing EPS yields a named gap and no scenario value", () => {
  assert.deepEqual(shown(publish("missing_input")), [["missing", "missing_input"], ...Array(3).fill(["blocked_dependency", "blocked_by_dependency"])]);
});

test("a product beyond the numeric limits is a gap, never a rounded value", () => {
  const huge = operand("eps", { metric: "eps_diluted", value: "1", scale: `1${"0".repeat(980)}`, native: `1${"0".repeat(980)}`, unit: { kind: "currency_per_share", currency: "USD" }, ...FY2023, share_basis: "diluted" });
  const node = { node_id: "bull", operation: "scenario_eps_multiple" as const, operation_version: "scenario_eps_multiple.v1", earnings: "eps", assumption_id: "pe_bull" };
  const outcome = scenarioEpsMultiple(node, huge, "1".padEnd(30, "0"));
  assert.deepEqual(outcome.ok ? outcome.payload : [outcome.disposition, outcome.reason_code], ["unsupported", "numeric_limit_exceeded"]);
  const within = scenarioEpsMultiple(node, huge, "10");
  assert.ok(within.ok && within.payload.kind === "value" && within.payload.value === `1${"0".repeat(981)}`);
});

test("bear, base and bull read one EPS and are each published once, in one unit", () => {
  const twoYears = mutable(scenarioPlanFixture());
  twoYears.operations.push({ ...twoYears.operations[0], node_id: "eps_2022", period: { kind: "fiscal_period", fiscal_year: 2022, fiscal_period: "FY" } });
  twoYears.operations[2].earnings = "eps_2022";
  const twoUnits = mutable(scenarioPlanFixture());
  twoUnits.publication_units.push({ ...twoUnits.publication_units[0], unit_id: "later" });
  twoUnits.outputs[3].unit_id = "later";
  const twice = mutable(scenarioPlanFixture());
  twice.outputs.push({ ...twice.outputs[3], output_id: "out_bull_again" });
  const unpublished = mutable(scenarioPlanFixture());
  unpublished.outputs.pop();
  const SPLIT = ["split_scenarios $.operations"];
  assert.deepEqual([issues(twoYears), issues(twoUnits), issues(twice), issues(unpublished)], [SPLIT, SPLIT, SPLIT, SPLIT]);
});

test("a scenario value is never read as EPS", () => {
  const chained = mutable(scenarioPlanFixture());
  chained.operations[3].earnings = "bear";
  assert.deepEqual(issues(chained), ["invalid_scenario_earnings $.operations[3].earnings", "split_scenarios $.operations"]);
});
