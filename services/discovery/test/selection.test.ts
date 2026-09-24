import assert from "node:assert/strict";
import test from "node:test";

import { rankShortlist } from "../src/selection.ts";
import type { CandidateDecision, Level } from "../src/types.ts";
import { identityFixture } from "./fixtures.ts";

function decision(index: number, levels: { exposure?: Level; evidence?: Level; quality?: Level; valuation?: Level } = {}): CandidateDecision {
  return {
    candidate_id: `90000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
    identity: identityFixture(index),
    state: "eligible_not_shortlisted",
    dimensions: {
      theme_exposure: { level: levels.exposure ?? "mixed", explanation: "Evidence supports exposure.", citations: [] },
      evidence_strength: { level: levels.evidence ?? "mixed", explanation: "Evidence supports the assessment.", citations: [] },
      business_quality: { level: levels.quality ?? "mixed", explanation: "Evidence supports quality.", citations: [] },
      valuation_context: { level: levels.valuation ?? "unknown", explanation: "Valuation context only.", citations: [] },
    },
    criteria: [], counterarguments: [], unresolved_questions: [], next_action: "Collect no further evidence.", reason_codes: [],
  };
}

test("ranking has no result for zero eligible candidates", () => {
  assert.deepEqual(rankShortlist([]), []);
  assert.deepEqual(rankShortlist([{ ...decision(0), state: "needs_evidence" }]), [{ ...decision(0), state: "needs_evidence", rank: null }]);
});

test("ranking keeps only the first ten of twenty-five eligible candidates", () => {
  const ranked = rankShortlist(Array.from({ length: 25 }, (_, index) => decision(index)));

  assert.equal(ranked.filter((item) => item.state === "shortlisted").length, 10);
  assert.deepEqual(ranked.slice(0, 10).map((item) => item.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(ranked.slice(10).every((item) => item.state === "eligible_not_shortlisted" && item.rank === null));
});

test("ranking breaks equal evidence ties by issuer UUID and ignores valuation", () => {
  const highValuation = decision(2, { valuation: "strong" });
  const lowValuation = decision(1, { valuation: "weak" });
  const strongerExposure = decision(0, { exposure: "strong", valuation: "unknown" });

  const ranked = rankShortlist([highValuation, lowValuation, strongerExposure]);

  assert.deepEqual(ranked.map((item) => item.candidate_id), [strongerExposure.candidate_id, lowValuation.candidate_id, highValuation.candidate_id]);
  assert.deepEqual(ranked.map((item) => item.rank), [1, 2, 3]);
});
