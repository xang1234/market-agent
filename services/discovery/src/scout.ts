import { createHash } from "node:crypto";

import { hashJsonValue } from "../../observability/src/tool-call.ts";
import type { DiscoveryContext, DiscoveryPool } from "./ports.ts";
import { buildScoutMessages, parseScoutSelection, type ScoutSeedChoice } from "./scout-prompt.ts";
import { EMPTY_COVERAGE } from "./policy.ts";
import { DiscoveryError, type Coverage, type DiscoveredCandidate, type Id, type Origin, type SearchHit } from "./types.ts";

const MAX_DISCOVERY_SEARCHES = 20;
const MAX_CANDIDATES = 100;
const MAX_SCOUT_BATCHES = 4;
const MAX_MODEL_INPUT_CHARS = 64_000;

type PlannedQuery = { query: string; mechanism_id: Id; query_index: number };
type CollectedHit = { hit: SearchHit; mechanism_id: Id; first_seen: [number, number] };
type CandidateLead = Omit<DiscoveredCandidate, "candidate_id" | "identity"> & { identity_query: string };
type ScoutBatch = { hits: CollectedHit[]; seed_queries: string[] };

export async function discoverCandidates(context: DiscoveryContext): Promise<DiscoveryPool> {
  const coverage = mutableCoverage(context.brief);
  const planned = planQueries(context.brief);
  coverage.searches_planned = planned.length;
  const hits = await collectHits(context, planned, coverage);
  const selected = await selectLeads(context, hits, coverage);
  const existing = await existingLeads(context, coverage);
  const leads = uniqueLeads([...selected.seeds, ...existing, ...selected.web]);
  const admitted = await resolveAndAdmit(context, leads, coverage);
  updateDiscoveryCoverage(coverage, admitted, context.brief.mechanisms.map((mechanism) => mechanism.mechanism_id));
  return { candidates: admitted, coverage };
}

export function planQueries(brief: DiscoveryContext["brief"]): PlannedQuery[] {
  const perMechanism = new Map(brief.mechanisms.map((mechanism) => [mechanism.mechanism_id, [] as string[]]));
  for (const query of brief.queries) perMechanism.get(query.mechanism_id)?.push(query.query);
  const plan: PlannedQuery[] = [];
  while (plan.length < MAX_DISCOVERY_SEARCHES) {
    let added = false;
    for (const mechanism of brief.mechanisms) {
      const query = perMechanism.get(mechanism.mechanism_id)?.shift();
      if (query === undefined) continue;
      plan.push({ query, mechanism_id: mechanism.mechanism_id, query_index: plan.length });
      added = true;
      if (plan.length === MAX_DISCOVERY_SEARCHES) break;
    }
    if (!added) return plan;
  }
  return plan;
}

async function collectHits(context: DiscoveryContext, planned: PlannedQuery[], coverage: Coverage): Promise<CollectedHit[]> {
  const collected = new Map<Id, CollectedHit>();
  for (const query of planned) {
    try {
      const result = await context.providers.search.search({
        query: query.query,
        query_index: query.query_index,
        operation_key: `${context.run_id}/discovery/pool/search/${query.query_index}`,
        request_hash: requestHash({ kind: "discovery-search-v1", run_id: context.run_id, query }),
        phase: "discovery",
      }, context.operations);
      coverage.searches_completed += 1;
      if (result.hits_truncated === null) addGap(coverage, "search_truncation_unknown", null, `query ${query.query_index}`);
      else if (Number.isSafeInteger(result.hits_truncated) && result.hits_truncated >= 0) coverage.hits_truncated += result.hits_truncated;
      else addGap(coverage, "search_truncation_invalid", null, `query ${query.query_index}`);
      for (const hit of result.hits) {
        const current: CollectedHit = { hit, mechanism_id: query.mechanism_id, first_seen: [query.query_index, hit.result_index] };
        const previous = collected.get(hit.hit_id);
        if (previous === undefined || compareHit(current, previous) < 0) collected.set(hit.hit_id, current);
      }
    } catch (error) {
      if (stageControlError(error)) throw error;
      if (budgetStopped(error)) {
        addGap(coverage, "discovery_search_budget_exhausted", null, `query ${query.query_index}`);
        break;
      }
      addGap(coverage, "discovery_search_failed", null, `query ${query.query_index}`);
    }
  }
  return [...collected.values()].sort(compareHit);
}

async function selectLeads(
  context: DiscoveryContext,
  hits: CollectedHit[],
  coverage: Coverage,
): Promise<{ web: CandidateLead[]; seeds: CandidateLead[] }> {
  const { batches, skipped } = packScoutBatches(context.brief, hits);
  coverage.extraction_batches_skipped += skipped;
  if (skipped > 0) addGap(coverage, "scout_input_not_covered", null, `${skipped} hit inputs could not fit the four bounded Scout batches`);

  const chosenHits = new Set<Id>();
  const chosenSeeds = new Map<string, ScoutSeedChoice>();
  const mechanismIds = new Set(context.brief.mechanisms.map((mechanism) => mechanism.mechanism_id));
  for (const [batchIndex, batch] of batches.entries()) {
    const messages = buildScoutMessages({ brief: context.brief, hits: batch.hits.map(({ hit }) => hit), seed_queries: batch.seed_queries });
    try {
      const result = await context.model.complete({
        operation_key: `${context.run_id}/discovery/pool/scout/${batchIndex}`,
        request_hash: requestHash({ kind: "discovery-scout-v1", run_id: context.run_id, brief: context.brief, messages }),
        role: "scout",
        phase: "discovery",
        messages,
      });
      const selection = parseScoutSelection(
        result.text,
        new Set(batch.hits.map(({ hit }) => hit.hit_id)),
        new Set(batch.seed_queries),
        mechanismIds,
      );
      selection.hit_ids.forEach((hitId) => chosenHits.add(hitId));
      selection.seeds.forEach((seed) => chosenSeeds.set(`${seed.seed_query}\u0000${seed.mechanism_id}`, seed));
      if (selection.rejected > 0) addGap(coverage, "scout_ungrounded_output", null, `${selection.rejected} ungrounded Scout selections were ignored`);
    } catch (error) {
      if (stageControlError(error)) throw error;
      addGap(coverage, budgetStopped(error) ? "scout_model_budget_exhausted" : "scout_model_output_unavailable", null, `batch ${batchIndex}`);
      if (budgetStopped(error)) break;
    }
  }

  const byHitId = new Map(hits.map((entry) => [entry.hit.hit_id, entry]));
  const web = [...chosenHits].map((hitId) => byHitId.get(hitId)).filter((entry): entry is CollectedHit => entry !== undefined)
    .sort(compareHit).map(webLead);
  const seeds = [...chosenSeeds.values()].sort(compareSeed).map(seedLead);
  return { web, seeds };
}

function packScoutBatches(brief: DiscoveryContext["brief"], hits: CollectedHit[]): { batches: ScoutBatch[]; skipped: number } {
  const batches: ScoutBatch[] = [];
  let current: CollectedHit[] = [];
  let currentSeeds = [...brief.seed_queries];
  let skipped = 0;

  const fits = (candidateHits: CollectedHit[], seeds: string[]) =>
    JSON.stringify(buildScoutMessages({ brief, hits: candidateHits.map(({ hit }) => hit), seed_queries: seeds })).length <= MAX_MODEL_INPUT_CHARS;
  const flush = (): boolean => {
    if (current.length === 0 && currentSeeds.length === 0) return true;
    if (batches.length === MAX_SCOUT_BATCHES) return false;
    if (!fits(current, currentSeeds)) return false;
    batches.push({ hits: current, seed_queries: currentSeeds });
    current = [];
    currentSeeds = [];
    return true;
  };

  for (const hit of hits) {
    if (fits([...current, hit], currentSeeds)) {
      current.push(hit);
      continue;
    }
    if (current.length > 0 && flush() && fits([hit], currentSeeds)) {
      current.push(hit);
      continue;
    }
    skipped += 1;
  }
  if (!flush()) skipped += Math.max(current.length, 1);
  return { batches, skipped };
}

async function existingLeads(context: DiscoveryContext, coverage: Coverage): Promise<CandidateLead[]> {
  const mechanismIds = new Set(context.brief.mechanisms.map((mechanism) => mechanism.mechanism_id));
  const leads: CandidateLead[] = [];
  for (const candidate of [...context.existing].sort(compareCandidateInput)) {
    const accessible = await context.canUseExisting(candidate);
    if (!accessible) {
      addGap(coverage, "existing_evidence_unavailable", null, "Existing evidence was unavailable to this run");
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
      identity_query: candidate.identity?.ticker ?? candidate.name,
      origins: ["existing"],
      mechanism_ids: mechanisms,
      seed: context.brief.seed_queries.includes(candidate.name),
      primary_domain_lead: false,
      first_seen: candidate.first_seen,
      lead_hit_ids: [...candidate.lead_hit_ids],
      reason_codes: [...candidate.reason_codes, "existing_identity_revalidated"],
    });
  }
  return leads;
}

async function resolveAndAdmit(context: DiscoveryContext, leads: CandidateLead[], coverage: Coverage): Promise<DiscoveredCandidate[]> {
  const limited = leads.slice(0, MAX_CANDIDATES);
  coverage.leads_overflow += leads.length - limited.length;
  if (leads.length > limited.length) addGap(coverage, "candidate_limit_reached", null, `${leads.length - limited.length} grounded leads were not resolved`);

  const byIssuer = new Map<Id, DiscoveredCandidate>();
  const unresolved: DiscoveredCandidate[] = [];
  for (const lead of limited) {
    const candidateId = stableUuid(`discovery-candidate\u0000${context.run_id}\u0000${lead.lead_key}`);
    let resolution: Awaited<ReturnType<DiscoveryContext["providers"]["identity"]["resolve"]>>;
    try {
      resolution = await context.providers.identity.resolve({
        query: lead.identity_query,
        hit_ids: lead.lead_hit_ids,
        operation_key: `${context.run_id}/discovery/${candidateId}/identity`,
        request_hash: requestHash({ kind: "discovery-identity-v1", run_id: context.run_id, candidate_id: candidateId, lead }),
        phase: "discovery",
        candidate_id: candidateId,
      }, context.operations);
    } catch (error) {
      if (stageControlError(error)) throw error;
      if (budgetStopped(error)) {
        addGap(coverage, "identity_budget_exhausted", null, "Identity resolution stopped before all grounded leads were checked");
        break;
      }
      addGap(coverage, "identity_resolution_failed", candidateId, "Identity resolution failed");
      const unresolvedCandidate: DiscoveredCandidate = {
        candidate_id: candidateId,
        lead_key: lead.lead_key,
        name: lead.name,
        identity: null,
        origins: lead.origins,
        mechanism_ids: lead.mechanism_ids,
        seed: lead.seed,
        primary_domain_lead: lead.primary_domain_lead,
        first_seen: lead.first_seen,
        lead_hit_ids: lead.lead_hit_ids,
        reason_codes: [...lead.reason_codes, "identity_resolution_failed"],
      };
      await context.admit(unresolvedCandidate);
      unresolved.push(unresolvedCandidate);
      continue;
    }
    const candidate: DiscoveredCandidate = {
      candidate_id: candidateId,
      lead_key: lead.lead_key,
      name: lead.name,
      identity: resolution.status === "resolved" ? resolution.identity : null,
      origins: lead.origins,
      mechanism_ids: lead.mechanism_ids,
      seed: lead.seed,
      primary_domain_lead: lead.primary_domain_lead,
      first_seen: lead.first_seen,
      lead_hit_ids: lead.lead_hit_ids,
      reason_codes: resolution.status === "resolved" ? lead.reason_codes : [...lead.reason_codes, `identity_unresolved:${resolution.reason.slice(0, 80)}`],
    };
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
    const merged = mergeCandidate(existing, candidate);
    await context.admit(merged);
    byIssuer.set(merged.identity!.issuer_id, merged);
  }
  return [...unresolved, ...byIssuer.values()].sort(compareCandidateInput);
}

function webLead(entry: CollectedHit): CandidateLead {
  const { hit, mechanism_id, first_seen } = entry;
  return {
    lead_key: `hit:${hit.hit_id}`,
    name: hit.title.slice(0, 500),
    identity_query: tickerFromTitle(hit.title) ?? hit.title.slice(0, 600),
    origins: ["web"],
    mechanism_ids: [mechanism_id],
    seed: false,
    primary_domain_lead: false,
    first_seen,
    lead_hit_ids: [hit.hit_id],
    reason_codes: ["scout_selected_hit"],
  };
}

function seedLead(seed: ScoutSeedChoice): CandidateLead {
  return {
    lead_key: `seed:${seed.seed_query}\u0000${seed.mechanism_id}`,
    name: seed.seed_query,
    identity_query: seed.seed_query,
    origins: ["seed"],
    mechanism_ids: [seed.mechanism_id],
    seed: true,
    primary_domain_lead: false,
    first_seen: [0, 0],
    lead_hit_ids: [],
    reason_codes: ["approved_seed"],
  };
}

function uniqueLeads(leads: CandidateLead[]): CandidateLead[] {
  const unique = new Map<string, CandidateLead>();
  for (const lead of leads) {
    const existing = unique.get(lead.lead_key);
    unique.set(lead.lead_key, existing === undefined ? lead : mergeLead(existing, lead));
  }
  return [...unique.values()];
}

function mergeLead(left: CandidateLead, right: CandidateLead): CandidateLead {
  return {
    ...left,
    origins: union(left.origins, right.origins),
    mechanism_ids: union(left.mechanism_ids, right.mechanism_ids),
    seed: left.seed || right.seed,
    primary_domain_lead: left.primary_domain_lead || right.primary_domain_lead,
    first_seen: compareFirstSeen(left.first_seen, right.first_seen) <= 0 ? left.first_seen : right.first_seen,
    lead_hit_ids: union(left.lead_hit_ids, right.lead_hit_ids),
    reason_codes: union(left.reason_codes, right.reason_codes),
  };
}

function mergeCandidate(left: DiscoveredCandidate, right: DiscoveredCandidate): DiscoveredCandidate {
  return {
    ...left,
    origins: union(left.origins, right.origins),
    mechanism_ids: union(left.mechanism_ids, right.mechanism_ids),
    seed: left.seed || right.seed,
    primary_domain_lead: left.primary_domain_lead || right.primary_domain_lead,
    first_seen: compareFirstSeen(left.first_seen, right.first_seen) <= 0 ? left.first_seen : right.first_seen,
    lead_hit_ids: union(left.lead_hit_ids, right.lead_hit_ids),
    reason_codes: union(left.reason_codes, right.reason_codes),
  };
}

function updateDiscoveryCoverage(coverage: Coverage, candidates: DiscoveredCandidate[], mechanismIds: Id[]): void {
  coverage.unresolved = candidates.filter((candidate) => candidate.identity === null).length;
  coverage.discovered = candidates.length - coverage.unresolved;
  coverage.mechanisms = mechanismIds.map((mechanism_id) => ({
    mechanism_id,
    discovered: candidates.filter((candidate) => candidate.identity !== null && candidate.mechanism_ids.includes(mechanism_id)).length,
    selected: 0,
    assessed: 0,
  }));
}

function mutableCoverage(brief: DiscoveryContext["brief"]): Coverage {
  return {
    ...EMPTY_COVERAGE,
    mechanisms: brief.mechanisms.map((mechanism) => ({ mechanism_id: mechanism.mechanism_id, discovered: 0, selected: 0, assessed: 0 })),
    gaps: [],
  };
}

function addGap(coverage: Coverage, code: string, candidate_id: Id | null, detail: string): void {
  coverage.gaps.push({ code, candidate_id, detail: detail.slice(0, 300) });
}

function requestHash(value: unknown): string {
  return hashJsonValue(value as never);
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const raw = hex.join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

function tickerFromTitle(title: string): string | null {
  const match = /\(([A-Z]{1,10})\)/u.exec(title);
  return match?.[1] ?? null;
}

function budgetStopped(error: unknown): boolean {
  return error instanceof DiscoveryError && error.code === "budget_exhausted";
}

function stageControlError(error: unknown): boolean {
  return error instanceof DiscoveryError && error.code !== "budget_exhausted";
}

function compareHit(left: CollectedHit, right: CollectedHit): number {
  const order = compareFirstSeen(left.first_seen, right.first_seen);
  return order !== 0 ? order : left.hit.hit_id.localeCompare(right.hit.hit_id);
}

function compareSeed(left: ScoutSeedChoice, right: ScoutSeedChoice): number {
  return left.seed_query.localeCompare(right.seed_query) || left.mechanism_id.localeCompare(right.mechanism_id);
}

function compareCandidateInput(left: Pick<DiscoveredCandidate, "first_seen" | "lead_key" | "candidate_id">, right: Pick<DiscoveredCandidate, "first_seen" | "lead_key" | "candidate_id">): number {
  return compareFirstSeen(left.first_seen, right.first_seen) || left.lead_key.localeCompare(right.lead_key) || left.candidate_id.localeCompare(right.candidate_id);
}

function compareFirstSeen(left: [number, number], right: [number, number]): number {
  return left[0] - right[0] || left[1] - right[1];
}

function union<T>(left: T[], right: T[]): T[] {
  return [...new Set([...left, ...right])];
}
