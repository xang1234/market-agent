import type { CandidateDecision, Level, RankedDecision } from "./types.ts";

const SCORE: Record<Level, number> = { strong: 3, mixed: 2, weak: 1, unknown: 0 };

export function rankShortlist(decisions: ReadonlyArray<CandidateDecision>): RankedDecision[] {
  const eligible = decisions.filter((decision) => decision.state === "eligible_not_shortlisted").slice().sort(compareEligible);
  const ranked = eligible.map((decision, index) => ({
    ...decision,
    state: index < 10 ? "shortlisted" as const : "eligible_not_shortlisted" as const,
    rank: index < 10 ? index + 1 : null,
  }));
  const unavailable = decisions.filter((decision) => decision.state !== "eligible_not_shortlisted").map((decision) => ({ ...decision, rank: null }));
  return [...ranked, ...unavailable];
}

function compareEligible(left: CandidateDecision, right: CandidateDecision): number {
  return score(right.dimensions.theme_exposure.level) - score(left.dimensions.theme_exposure.level)
    || score(right.dimensions.evidence_strength.level) - score(left.dimensions.evidence_strength.level)
    || score(right.dimensions.business_quality.level) - score(left.dimensions.business_quality.level)
    || binaryCompare(left.identity.issuer_id, right.identity.issuer_id);
}

function score(level: Level): number { return SCORE[level]; }

function binaryCompare(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
