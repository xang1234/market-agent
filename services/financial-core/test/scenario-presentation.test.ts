// The certified presentation of P/E scenarios (#201): one scenarios table
// over its EPS, each row naming the user's multiple and when they stated it,
// with a fixed disclosure, under financial-presentation.v3.

import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonical } from "../src/canonical.ts";
import type { BoundFinancialInputV1, FinancialPlan, LocalId } from "../src/contracts.ts";
import { evaluateBoundPlan, nodeLineageHashes, unitPublication, type SlotBinding } from "../src/bound-evaluation.ts";
import { presentFinancialUnit, type FinancialAnswerContent } from "../src/presentation.ts";
import { validateFinancialPlan } from "../src/validate.ts";
import { mutable, scenarioPlanFixture } from "./fixtures.ts";
import { boundInput } from "./operand-fixtures.ts";

function present(value: string, edit: (plan: any) => void = () => {}): FinancialAnswerContent {
  const draft = mutable(scenarioPlanFixture());
  edit(draft);
  const validated = validateFinancialPlan(draft);
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  const plan: FinancialPlan = validated.value;
  const input: BoundFinancialInputV1 = boundInput({ metric: "eps_diluted", value, unit: { kind: "currency_per_share", currency: "USD" }, start: "2023-01-01", end: "2023-12-31", share_basis: "diluted" });
  const bindings = new Map<LocalId, SlotBinding>([["eps", { status: "bound", input, payload_hash: hashCanonical("bound_input", input), candidate_set_digest: "c".repeat(64) }]]);
  const evaluation = evaluateBoundPlan(plan, bindings);
  const publication = unitPublication(plan, evaluation, nodeLineageHashes(plan, evaluation, bindings), "section");
  return presentFinancialUnit({
    plan, run_id: "run", unit_id: "section",
    results: publication.results.map((result) => ({ ...result, result_id: `r_${result.node_id}` })),
    subject_names: { a: "Alpha Industries Inc." },
    periods: new Map([["eps", { fiscal_year: 2023, fiscal_period: "FY", end: "2023-12-31" }]]),
  });
}

const assumptionHash = (scenario: string, value: string) =>
  hashCanonical("assumption", { assumption_id: `pe_${scenario}`, scenario, value, attribution: { kind: "user_request", ref: "chat:turn:1", captured_at: "2024-01-15T15:00:00.000Z" } });

test("EPS of 4 at 20x, 25x, and 30x is one scenarios table over that EPS, with the disclosure", () => {
  const content = present("4");
  assert.equal(content.presentation_version, "financial-presentation.v3");
  assert.deepEqual(content.presentations, [{
    kind: "scenarios",
    earnings_result_id: "r_eps",
    rows: (["bear", "base", "bull"] as const).map((scenario, index) => ({
      scenario,
      assumption_id: `pe_${scenario}`,
      multiple_text: `${["20", "25", "30"][index]}x`,
      attribution_text: "Your assumption in this request (2024-01-15 15:00 UTC)",
      assumption_hash: assumptionHash(scenario, ["20", "25", "30"][index]!),
      result_id: `r_${scenario}`,
    })),
    disclosure: "A mechanical scenario: reported diluted EPS × a P/E you supplied. Not a price target, forecast, or recommendation.",
  }]);
  const shown = content.results.map((result) => [content.labels[result.measure_label_id]!.text, content.labels[result.period_label_id]!.text, result.presented.text]);
  assert.deepEqual(shown, [
    ["EPS (diluted)", "FY2023 (ended 2023-12-31)", "USD 4.00 per share"],
    ["Bear scenario: diluted EPS × your 20x P/E", "FY2023 (ended 2023-12-31)", "USD 80.00 per share"],
    ["Base scenario: diluted EPS × your 25x P/E", "FY2023 (ended 2023-12-31)", "USD 100.00 per share"],
    ["Bull scenario: diluted EPS × your 30x P/E", "FY2023 (ended 2023-12-31)", "USD 120.00 per share"],
  ]);
});

test("a scenario that does not apply stays a row, and its result says why", () => {
  const content = present("-1");
  const table = content.presentations[0]!;
  assert.ok(table.kind === "scenarios");
  assert.deepEqual(table.rows.map((row) => row.result_id), ["r_bear", "r_base", "r_bull"]);
  assert.deepEqual(content.presentations.length, 1);
  assert.equal(content.results.find((result) => result.result_id === "r_base")!.presented.kind, "gap");
});

test("a multiple carried from an earlier request says so, and keeps its own time", () => {
  const table = present("4", (plan) => {
    plan.origin.ref = "chat:turn:2";
    plan.assumptions[1].attribution = { kind: "user_request", ref: "chat:turn:2", captured_at: "2024-01-16T09:30:00.000Z" };
  }).presentations[0]!;
  assert.ok(table.kind === "scenarios");
  assert.deepEqual(table.rows.map((row) => row.attribution_text), [
    "Your assumption in an earlier request (2024-01-15 15:00 UTC)",
    "Your assumption in this request (2024-01-16 09:30 UTC)",
    "Your assumption in an earlier request (2024-01-15 15:00 UTC)",
  ]);
});
