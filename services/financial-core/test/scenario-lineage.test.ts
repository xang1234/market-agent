// P/E scenario lineage (#201): an assumption enters its scenario node's
// computation hash and input_refs by id and hash, and nowhere else.

import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonical } from "../src/canonical.ts";
import type { BoundFinancialInputV1, FinancialPlan, LocalId } from "../src/contracts.ts";
import { evaluateBoundPlan, nodeLineageHashes, unitPublication, type SlotBinding } from "../src/bound-evaluation.ts";
import { validateFinancialPlan } from "../src/validate.ts";
import { mutable, scenarioPlanFixture, type Multiples } from "./fixtures.ts";
import { boundInput } from "./operand-fixtures.ts";

const DIGEST = "c".repeat(64);

function scenarioPlan(multiples?: Multiples): FinancialPlan {
  const validated = validateFinancialPlan(scenarioPlanFixture(multiples));
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

const eps = (value: string): BoundFinancialInputV1 => boundInput({
  metric: "eps_diluted", value, unit: { kind: "currency_per_share", currency: "USD" }, start: "2023-01-01", end: "2023-12-31", fiscal_year: 2023, fiscal_period: "FY", share_basis: "diluted",
});

function lineage(plan: FinancialPlan, input = eps("4")) {
  const bindings = new Map<LocalId, SlotBinding>([["eps", { status: "bound", input, payload_hash: hashCanonical("bound_input", input), candidate_set_digest: DIGEST }]]);
  const evaluation = evaluateBoundPlan(plan, bindings);
  const publication = unitPublication(plan, evaluation, nodeLineageHashes(plan, evaluation, bindings), "section");
  return { epsHash: hashCanonical("bound_input", input), computations: Object.fromEntries(publication.computations.map((computation) => [computation.node_id, computation])) };
}

test("a scenario's computation names its EPS and, after it, its assumption by id and hash", () => {
  const input = eps("4");
  const { epsHash, computations } = lineage(scenarioPlan(), input);
  assert.deepEqual(Object.keys(computations), ["bear", "base", "bull"]);
  assert.deepEqual(computations.base!.input_refs, [
    { node_id: "eps", hash: epsHash },
    {
      assumption_id: "pe_base",
      hash: hashCanonical("assumption", { assumption_id: "pe_base", scenario: "base", value: "25", attribution: { kind: "user_request", ref: "chat:turn:1", captured_at: "2024-01-15T15:00:00.000Z" } }),
    },
  ]);
});

test("changing one assumption's value or attribution moves only its scenario's lineage", () => {
  const input = eps("4");
  const before = lineage(scenarioPlan(), input).computations;
  const value = lineage(scenarioPlan({ bear: "20", base: "22", bull: "30" }), input).computations;
  const reattributed = mutable(scenarioPlanFixture());
  reattributed.assumptions[1].attribution.ref = "chat:turn:2";
  const validated = validateFinancialPlan(reattributed);
  assert.ok(validated.ok);
  const attribution = lineage(validated.value, input).computations;
  for (const after of [value, attribution]) {
    assert.notEqual(after.base!.output_hash, before.base!.output_hash);
    assert.notDeepEqual(after.base!.input_refs[1], before.base!.input_refs[1]);
    assert.deepEqual(after.base!.input_refs[0], before.base!.input_refs[0]);
    assert.deepEqual([after.bear, after.bull], [before.bear, before.bull]);
  }
});
