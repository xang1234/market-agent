import type { DiscoveryContext, DiscoveryPool } from "./ports.ts";
import { buildScoutMessages, parseScoutSelection, type ScoutSeedChoice } from "./scout-prompt.ts";
import { type CandidateLead, type CollectedHit, existingLeads, resolveAndAdmit, seedLead, uniqueLeads, webLead } from "./scout-leads.ts";
import { addGap, budgetStopped, compareFirstSeen, requestHash, stageControlError } from "./scout-support.ts";
import { EMPTY_COVERAGE } from "./policy.ts";
import type { Coverage, DiscoveredCandidate, Id, SearchHit } from "./types.ts";

const MAX_DISCOVERY_SEARCHES = 20;
const MAX_SCOUT_BATCHES = 4;
const MAX_MODEL_INPUT_CHARS = 64_000;

type PlannedQuery = { query: string; mechanism_id: Id; query_index: number };
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

function compareHit(left: CollectedHit, right: CollectedHit): number {
  const order = compareFirstSeen(left.first_seen, right.first_seen);
  return order !== 0 ? order : left.hit.hit_id.localeCompare(right.hit.hit_id);
}

function compareSeed(left: ScoutSeedChoice, right: ScoutSeedChoice): number {
  return left.seed_query.localeCompare(right.seed_query) || left.mechanism_id.localeCompare(right.mechanism_id);
}
