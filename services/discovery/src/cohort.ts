import type { Brief, DiscoveredCandidate, Id } from "./types.ts";

const MAX_RESEARCH_COHORT = 25;
const MAX_PRIORITY_SEEDS = 5;

/**
 * Returns the durable evaluation order for resolved, eligible discovery rows.
 * Persistence belongs to the worker, which commits this exact sequence before
 * beginning company research.
 */
export function chooseResearchCohort(brief: Brief, candidates: DiscoveredCandidate[]): Id[] {
  const eligible = eligibleCandidates(brief, candidates);
  const selected = new Set<Id>();
  const selectedIssuers = new Set<Id>();
  const cohort: Id[] = [];

  addRoundRobin(brief, eligible.filter((candidate) => candidate.seed), MAX_PRIORITY_SEEDS, cohort, selected, selectedIssuers);
  addRoundRobin(brief, eligible, MAX_RESEARCH_COHORT, cohort, selected, selectedIssuers);
  return cohort;
}

function eligibleCandidates(brief: Brief, candidates: DiscoveredCandidate[]): DiscoveredCandidate[] {
  const mechanismIds = new Set(brief.mechanisms.map((mechanism) => mechanism.mechanism_id));
  const byIssuer = new Map<Id, DiscoveredCandidate>();
  for (const candidate of candidates) {
    if (candidate.identity === null) continue;
    if (!candidate.mechanism_ids.some((mechanismId) => mechanismIds.has(mechanismId))) continue;
    const existing = byIssuer.get(candidate.identity.issuer_id);
    if (existing === undefined || compareCandidates(candidate, existing) < 0) byIssuer.set(candidate.identity.issuer_id, candidate);
  }
  return [...byIssuer.values()];
}

function addRoundRobin(
  brief: Brief,
  candidates: DiscoveredCandidate[],
  limit: number,
  cohort: Id[],
  selected: Set<Id>,
  selectedIssuers: Set<Id>,
): void {
  const buckets = new Map(brief.mechanisms.map((mechanism) => [
    mechanism.mechanism_id,
    candidates.filter((candidate) => candidate.mechanism_ids.includes(mechanism.mechanism_id)).sort(compareCandidates),
  ]));

  while (cohort.length < limit) {
    let progressed = false;
    for (const mechanism of brief.mechanisms) {
      if (cohort.length >= limit) break;
      const candidate = buckets.get(mechanism.mechanism_id)?.find((entry) =>
        !selected.has(entry.candidate_id) && entry.identity !== null && !selectedIssuers.has(entry.identity.issuer_id),
      );
      if (candidate === undefined || candidate.identity === null) continue;
      cohort.push(candidate.candidate_id);
      selected.add(candidate.candidate_id);
      selectedIssuers.add(candidate.identity.issuer_id);
      progressed = true;
    }
    if (!progressed) return;
  }
}

function compareCandidates(left: DiscoveredCandidate, right: DiscoveredCandidate): number {
  if (left.primary_domain_lead !== right.primary_domain_lead) return left.primary_domain_lead ? -1 : 1;
  const queryOrder = left.first_seen[0] - right.first_seen[0];
  if (queryOrder !== 0) return queryOrder;
  const resultOrder = left.first_seen[1] - right.first_seen[1];
  if (resultOrder !== 0) return resultOrder;
  const issuerOrder = (left.identity?.issuer_id ?? "").localeCompare(right.identity?.issuer_id ?? "");
  if (issuerOrder !== 0) return issuerOrder;
  return left.candidate_id.localeCompare(right.candidate_id);
}
