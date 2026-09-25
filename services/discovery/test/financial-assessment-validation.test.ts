import assert from "node:assert/strict";
import test from "node:test";
import { decideCandidate } from "../src/assessment.ts";
import { hideOutcomes } from "../src/financial-outcomes.ts";
import { parseBrief } from "../src/validation.ts";
import type { AnalystOutput, Citation, CriterionOutcome, SkepticOutput } from "../src/types.ts";
import { analystFixture, packetFixture, skepticFixture } from "./fixtures.ts";
import { MARGIN_ID, NARRATIVE_ID, numericalBrief, REVENUE_ID } from "./financial-fixtures.ts";

const brief = parseBrief(numericalBrief());
const CLAIM = { kind: "claim", id: "b0000000-0000-4000-8000-000000000001" } as const;
const CERTIFIED = { run_id: "c0000000-0000-4000-8000-000000000001", unit_id: "condition", snapshot_id: "c1000000-0000-4000-8000-000000000001", certificate_digest: "e".repeat(64), result_hash: "f".repeat(64) };

/** Both roles claim every criterion passes, citing a real source claim. */
function roles(): { analyst: AnalystOutput; skeptic: SkepticOutput } {
  const criteria = brief.criteria.map((criterion) => ({ criterion_id: criterion.criterion_id, outcome: "pass" as const, explanation: "The filing states revenue of $383 billion.", citations: [CLAIM] }));
  return { analyst: { ...analystFixture(), criteria }, skeptic: { ...skepticFixture(), criteria } };
}

function certified(revenue: CriterionOutcome<Citation>["outcome"], margin: CriterionOutcome<Citation>["outcome"]) {
  const outcome = (criterion_id: string, value: CriterionOutcome<Citation>["outcome"]): CriterionOutcome<Citation> =>
    ({ criterion_id, outcome: value, explanation: "Verified calculation.", citations: [], certified: CERTIFIED });
  return new Map([[REVENUE_ID, outcome(REVENUE_ID, revenue)], [MARGIN_ID, outcome(MARGIN_ID, margin)]]);
}

test("a cited source number cannot turn a failed calculation into a pass", () => {
  const { analyst, skeptic } = roles();
  const decision = decideCandidate(brief, packetFixture(), analyst, skeptic, "2026-09-10T12:00:00Z", certified("fail", "pass"));
  const revenue = decision.criteria.find((criterion) => criterion.criterion_id === REVENUE_ID)!;
  assert.deepEqual([revenue.outcome, revenue.citations, revenue.certified], ["fail", [], CERTIFIED], "the calculation decides; its certificate is the citation");
  assert.equal(decision.state, "excluded");
  assert.deepEqual(decision.reason_codes, ["required_criterion_failed"]);
  assert.equal(decision.criteria.find((criterion) => criterion.criterion_id === NARRATIVE_ID)!.outcome, "pass", "narrative criteria still come from both roles");
});

test("an unknown mandatory calculation is never a pass, whatever the roles narrate", () => {
  const { analyst, skeptic } = roles();
  const decision = decideCandidate(brief, packetFixture(), analyst, skeptic, "2026-09-10T12:00:00Z", certified("unknown", "pass"));
  assert.equal(decision.state, "needs_evidence");
  assert.ok(decision.reason_codes.includes("required_criterion_unknown"));
});

test("every numerical criterion needs its certified outcome", () => {
  const { analyst, skeptic } = roles();
  const partial = certified("pass", "pass");
  partial.delete(MARGIN_ID);
  assert.throws(() => decideCandidate(brief, packetFixture(), analyst, skeptic, "2026-09-10T12:00:00Z", partial), /exactly one certified outcome/u);
});

test("a calculation whose inputs are no longer visible hides its criterion", () => {
  const hidden = hideOutcomes(certified("pass", "fail"), new Set([REVENUE_ID]));
  assert.deepEqual([hidden.get(REVENUE_ID)!.outcome, hidden.get(REVENUE_ID)!.certified], ["unknown", undefined]);
  assert.equal(hidden.get(MARGIN_ID)!.outcome, "fail");
});
