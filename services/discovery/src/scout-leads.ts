import type { DiscoveryContext } from "./ports.ts";
import type { ScoutSeedChoice } from "./scout-prompt.ts";
import { addGap, budgetStopped, compareFirstSeen, requestHash, stableUuid, stageControlError, union } from "./scout-support.ts";
import type { CompanyIdentity, Coverage, DiscoveredCandidate, Id, SearchHit } from "./types.ts";

export type CollectedHit = { hit: SearchHit; mechanism_id: Id; first_seen: [number, number] };
export type CandidateLead = Omit<DiscoveredCandidate, "candidate_id" | "identity"> & {
  identity_query: string;
  canonical_identity: CompanyIdentity | null;
};

export async function existingLeads(context: DiscoveryContext, coverage: Coverage): Promise<CandidateLead[]> {
  const mechanismIds = new Set(context.brief.mechanisms.map((mechanism) => mechanism.mechanism_id));
  const leads: CandidateLead[] = [];
  for (const candidate of [...context.existing].sort(compareCandidateInput)) {
    // Task 6 supplies this attestation from current user-visible issuer evidence.
    if (!await context.canUseExisting(candidate)) {
      addGap(coverage, "existing_evidence_unavailable", null, "Existing evidence was unavailable to this run");
      continue;
    }
    if (candidate.identity === null) {
      addGap(coverage, "existing_identity_unverified", null, "Existing evidence lacked an attested canonical identity");
      continue;
    }
    const mechanisms = candidate.mechanism_ids.filter((mechanismId) => mechanismIds.has(mechanismId));
    if (mechanisms.length === 0) {
      addGap(coverage, "existing_lead_mechanism_invalid", null, "Existing evidence had no current mechanism");
      continue;
    }
    leads.push({
      lead_key: `existing:${candidate.lead_key}`,
      name: candidate.name,
      identity_query: candidate.identity.ticker,
      canonical_identity: candidate.identity,
      origins: ["existing"],
      mechanism_ids: mechanisms,
      seed: context.brief.seed_queries.includes(candidate.name),
      primary_domain_lead: candidate.primary_domain_lead,
      first_seen: candidate.first_seen,
      lead_hit_ids: [...candidate.lead_hit_ids],
      reason_codes: [...candidate.reason_codes, "existing_identity_revalidated"],
    });
  }
  return leads;
}

export function webLead(entry: CollectedHit): CandidateLead {
  const { hit, mechanism_id, first_seen } = entry;
  return {
    lead_key: `hit:${hit.hit_id}`,
    name: hit.title.slice(0, 500),
    identity_query: tickerFromTitle(hit.title) ?? hit.title.slice(0, 600),
    canonical_identity: null,
    origins: ["web"], mechanism_ids: [mechanism_id], seed: false, primary_domain_lead: false,
    first_seen, lead_hit_ids: [hit.hit_id], reason_codes: ["scout_selected_hit"],
  };
}

export function seedLead(seed: ScoutSeedChoice): CandidateLead {
  return {
    lead_key: `seed:${seed.seed_query}\u0000${seed.mechanism_id}`,
    name: seed.seed_query, identity_query: seed.seed_query, canonical_identity: null,
    origins: ["seed"], mechanism_ids: [seed.mechanism_id], seed: true, primary_domain_lead: false,
    first_seen: [0, 0], lead_hit_ids: [], reason_codes: ["approved_seed"],
  };
}

export function uniqueLeads(leads: CandidateLead[]): CandidateLead[] {
  const unique = new Map<string, CandidateLead>();
  for (const lead of leads) {
    const existing = unique.get(lead.lead_key);
    unique.set(lead.lead_key, existing === undefined ? lead : mergeLead(existing, lead));
  }
  return [...unique.values()];
}

export async function resolveAndAdmit(context: DiscoveryContext, leads: CandidateLead[], coverage: Coverage): Promise<DiscoveredCandidate[]> {
  const limited = leads.slice(0, 100);
  coverage.leads_overflow += leads.length - limited.length;
  if (leads.length > limited.length) addGap(coverage, "candidate_limit_reached", null, `${leads.length - limited.length} grounded leads were not resolved`);

  const byIssuer = new Map<Id, DiscoveredCandidate>();
  const unresolved: DiscoveredCandidate[] = [];
  for (const lead of limited) {
    const candidateId = stableUuid(`discovery-candidate\u0000${context.run_id}\u0000${lead.lead_key}`);
    const candidate = await candidateForLead(context, lead, candidateId, coverage);
    if (candidate === null) break;
    if (candidate.identity === null) {
      await context.admit(candidate);
      unresolved.push(candidate);
      continue;
    }
    const existing = byIssuer.get(candidate.identity.issuer_id);
    if (existing === undefined) {
      await context.admit(candidate);
      byIssuer.set(candidate.identity.issuer_id, candidate);
      continue;
    }
    // Preserve this distinct lead key so repository issuer de-duplication can
    // durably merge its provenance into the first row.
    await context.admit(candidate);
    byIssuer.set(candidate.identity.issuer_id, mergeCandidate(existing, candidate));
  }
  return [...unresolved, ...byIssuer.values()].sort(compareCandidateInput);
}

async function candidateForLead(
  context: DiscoveryContext,
  lead: CandidateLead,
  candidateId: Id,
  coverage: Coverage,
): Promise<DiscoveredCandidate | null> {
  if (lead.canonical_identity !== null) return resolvedCandidate(lead, candidateId, lead.canonical_identity);
  try {
    const resolution = await context.providers.identity.resolve({
      query: lead.identity_query, hit_ids: lead.lead_hit_ids,
      operation_key: `${context.run_id}/discovery/${candidateId}/identity`,
      request_hash: requestHash({ kind: "discovery-identity-v1", run_id: context.run_id, candidate_id: candidateId, lead }),
      phase: "discovery", candidate_id: candidateId,
    }, context.operations);
    return resolution.status === "resolved"
      ? resolvedCandidate(lead, candidateId, resolution.identity)
      : unresolvedCandidate(lead, candidateId, `identity_unresolved:${resolution.reason.slice(0, 80)}`);
  } catch (error) {
    if (stageControlError(error)) throw error;
    if (budgetStopped(error)) {
      addGap(coverage, "identity_budget_exhausted", null, "Identity resolution stopped before all grounded leads were checked");
      return null;
    }
    addGap(coverage, "identity_resolution_failed", candidateId, "Identity resolution failed");
    return unresolvedCandidate(lead, candidateId, "identity_resolution_failed");
  }
}

function resolvedCandidate(lead: CandidateLead, candidate_id: Id, identity: CompanyIdentity): DiscoveredCandidate {
  return { ...candidateBase(lead, candidate_id), identity };
}

function unresolvedCandidate(lead: CandidateLead, candidate_id: Id, reason: string): DiscoveredCandidate {
  return { ...candidateBase(lead, candidate_id), identity: null, reason_codes: [...lead.reason_codes, reason] };
}

function candidateBase(lead: CandidateLead, candidate_id: Id): Omit<DiscoveredCandidate, "identity"> {
  const { identity_query: _identity_query, canonical_identity: _canonical_identity, ...candidate } = lead;
  return { ...candidate, candidate_id };
}

function mergeLead(left: CandidateLead, right: CandidateLead): CandidateLead {
  return {
    ...left,
    identity_query: left.canonical_identity === null && right.canonical_identity !== null ? right.identity_query : left.identity_query,
    canonical_identity: left.canonical_identity ?? right.canonical_identity,
    origins: union(left.origins, right.origins), mechanism_ids: union(left.mechanism_ids, right.mechanism_ids),
    seed: left.seed || right.seed, primary_domain_lead: left.primary_domain_lead || right.primary_domain_lead,
    first_seen: compareFirstSeen(left.first_seen, right.first_seen) <= 0 ? left.first_seen : right.first_seen,
    lead_hit_ids: union(left.lead_hit_ids, right.lead_hit_ids), reason_codes: union(left.reason_codes, right.reason_codes),
  };
}

function mergeCandidate(left: DiscoveredCandidate, right: DiscoveredCandidate): DiscoveredCandidate {
  return {
    ...left,
    origins: union(left.origins, right.origins), mechanism_ids: union(left.mechanism_ids, right.mechanism_ids),
    seed: left.seed || right.seed, primary_domain_lead: left.primary_domain_lead || right.primary_domain_lead,
    first_seen: compareFirstSeen(left.first_seen, right.first_seen) <= 0 ? left.first_seen : right.first_seen,
    lead_hit_ids: union(left.lead_hit_ids, right.lead_hit_ids), reason_codes: union(left.reason_codes, right.reason_codes),
  };
}

function tickerFromTitle(title: string): string | null {
  return /\(([A-Z]{1,10})\)/u.exec(title)?.[1] ?? null;
}

function compareCandidateInput(left: Pick<DiscoveredCandidate, "first_seen" | "lead_key" | "candidate_id">, right: Pick<DiscoveredCandidate, "first_seen" | "lead_key" | "candidate_id">): number {
  return compareFirstSeen(left.first_seen, right.first_seen) || left.lead_key.localeCompare(right.lead_key) || left.candidate_id.localeCompare(right.candidate_id);
}
