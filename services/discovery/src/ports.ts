import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import type { LlmChatMessage, LlmRouterResult } from "../../llm/src/router.ts";
import type { ThesisFact } from "../../agents/src/thesis-evaluator.ts";
import type * as D from "./types.ts";

export type Lease = { run_id: D.Id; user_id: D.Id; worker_id: string; epoch: number; expires_at: string };
export type Checkpoint = { version: 1; stage: D.Stage; cohort: D.Id[]; next_company: number; completed_operation_keys: string[] };
export type Excerpt = { excerpt_id: D.Id; document_id: D.Id; source_id: D.Id; family_key: string; title: string; url: string; published_at: string | null; retrieved_at: string; document_hash: string; normalized_start: number; text: string; primary: boolean; primary_eligible: boolean };
export type PacketFact = ThesisFact & { currency: string | null; fiscal_year: number | null; fiscal_period: string | null; period_start: string | null };
export type EvidencePacket = { candidate_id: D.Id; identity: D.CompanyIdentity; excerpts: Excerpt[]; claims: { claim_id: D.Id; document_id: D.Id; source_id: D.Id; text_canonical: string }[]; facts: PacketFact[]; counter_search_completed: boolean; coverage_gaps: string[] };
export type FinancialReadResult = { facts: PacketFact[]; missing_fields: string[]; coverage_gaps: string[] };
export type OperationContext = { signal: AbortSignal; attempt_number: 1 | 2 };
export type OperationRunner = {
  run<T>(input: { key: string; request_hash: string; resource: D.Resource; phase: "discovery" | "research" | "verification"; candidate_id?: D.Id; model_initial?: boolean; model_role?: "analyst" | "skeptic"; execute: (ctx: OperationContext) => Promise<T> }): Promise<T>;
  providerAttempt<T>(input: { key: string; request_hash: string; index: 0 | 1; resource: "model"; phase: "discovery" | "research" | "verification"; candidate_id?: D.Id; model_initial?: boolean; model_role?: "analyst" | "skeptic"; execute: (signal: AbortSignal) => Promise<T> }): Promise<T>;
};
export type CampaignModel = { complete(input: { operation_key: string; request_hash: string; attempt_number?: 1 | 2; role: "planner" | "scout" | "analyst" | "skeptic" | "summary"; phase: "discovery" | "research" | "verification"; candidate_id?: D.Id; model_initial?: boolean; messages: LlmChatMessage[] }): Promise<LlmRouterResult> };
export type ProviderOperation = { operation_key: string; request_hash: string; phase: "discovery" | "research" | "verification"; candidate_id?: D.Id };
export type SearchInput = ProviderOperation & { query: string; query_index: number };
export type SearchResult = { hits: D.SearchHit[]; hits_truncated: number | null };
export type SearchProvider = { search(input: SearchInput, operations: OperationRunner): Promise<SearchResult> };
export type IdentityProvider = { resolve(input: ProviderOperation & { query: string; hit_ids: D.Id[] }, operations: OperationRunner): Promise<{ status: "resolved"; identity: D.CompanyIdentity } | { status: "unresolved"; reason: string }> };
export type EvidenceProvider = { acquire(input: ProviderOperation & { brief: D.Brief; candidate: D.DiscoveredCandidate; as_of: string }, operations: OperationRunner): Promise<EvidencePacket> };
export type FinancialProvider = { read(input: ProviderOperation & { identity: D.CompanyIdentity; as_of: string; candidate_id: D.Id }, operations: OperationRunner): Promise<FinancialReadResult> };
export type Providers = { search: SearchProvider; identity: IdentityProvider; evidence: EvidenceProvider; financials: FinancialProvider };
export type DiscoveryContext = { run_id: D.Id; brief: D.Brief; providers: Providers; model: CampaignModel; operations: OperationRunner; existing: D.DiscoveredCandidate[]; canUseExisting: (candidate: D.DiscoveredCandidate) => Promise<boolean>; admit: (candidate: D.DiscoveredCandidate) => Promise<void> };
export type DiscoveryPool = { candidates: D.DiscoveredCandidate[]; coverage: D.Coverage };
export type AssessmentContext = { run_id: D.Id; brief: D.Brief; packet: EvidencePacket; model: CampaignModel; as_of: string; persistQuotes: (raw: D.AnalystOutput | D.SkepticOutput) => Promise<Map<string, D.Citation>> };
export type AttemptReservation = { attempt_id: D.Id; attempt_number: 1 | 2; state: "dispatch" | "cached" | "exhausted" | "in_progress"; result: unknown };
export type StoredCandidate = D.DiscoveredCandidate & { state: D.CandidateState; ordinal: number | null; assessment: D.CandidateDecision | null; snapshot_id: D.Id | null; rank: number | null };

export interface DiscoveryRepository {
  createCampaign(userId: D.Id, input: { name: string; question: string }): Promise<D.Campaign>;
  getCampaign(userId: D.Id, campaignId: D.Id): Promise<D.Campaign>;
  listCampaigns(userId: D.Id, cursor: string | null, limit: number): Promise<D.Page<D.Campaign>>;
  getBrief(userId: D.Id, briefId: D.Id): Promise<D.SavedBrief>;
  currentBrief(userId: D.Id, campaignId: D.Id): Promise<D.SavedBrief | null>;
  saveBrief(userId: D.Id, campaignId: D.Id, expectedVersion: number, brief: D.Brief): Promise<D.SavedBrief>;
  startRun(userId: D.Id, campaignId: D.Id, input: { brief_version: number; brief_hash: string; request_key: D.Id }): Promise<D.RunRecord>;
  readRun(userId: D.Id, runId: D.Id): Promise<D.RunRecord>;
  listRuns(userId: D.Id, campaignId: D.Id, cursor: string | null, limit: number): Promise<D.Page<D.RunRecord>>;
  claimNextRun(workerId: string): Promise<Lease | null>;
  heartbeat(lease: Lease): Promise<Lease>;
  checkpoint(lease: Lease): Promise<Checkpoint>;
  saveCheckpoint(lease: Lease, checkpoint: Checkpoint): Promise<void>;
  candidates(userId: D.Id, runId: D.Id): Promise<StoredCandidate[]>;
  admitCandidate(lease: Lease, candidate: D.DiscoveredCandidate): Promise<void>;
  commitCohort(lease: Lease, candidateIds: D.Id[], coverage: D.Coverage): Promise<void>;
  failCandidate(lease: Lease, candidateId: D.Id, code: string): Promise<void>;
  reserveAttempt(scope: Lease | { campaign_id: D.Id; user_id: D.Id; draft_token: D.Id }, input: { operation_key: string; request_hash: string; resource: D.Resource; phase: "draft" | "discovery" | "research" | "verification"; candidate_id?: D.Id; attempt_number: 1 | 2; model_initial?: boolean; model_role?: "analyst" | "skeptic" }): Promise<AttemptReservation>;
  finishAttempt(scope: Lease | { campaign_id: D.Id; user_id: D.Id; draft_token: D.Id }, input: { attempt_id: D.Id; outcome: "success" | "error" | "unknown"; result: unknown; tool_call_id: D.Id | null }): Promise<void>;
  getOperation(userId: D.Id, runId: D.Id, key: string): Promise<{ outcome: string; result: unknown } | null>;
  acquireDraft(userId: D.Id, campaignId: D.Id, requestId: D.Id): Promise<{ draft_token: D.Id; expires_at: string }>;
  releaseDraft(userId: D.Id, campaignId: D.Id, token: D.Id): Promise<void>;
  appendEvent(lease: Lease, event: Omit<D.CampaignEvent, "run_id" | "sequence" | "created_at">): Promise<void>;
  events(userId: D.Id, runId: D.Id, after: number, limit: number): Promise<D.EventPage>;
  requestCancel(userId: D.Id, runId: D.Id): Promise<D.RunRecord>;
  finalize(lease: Lease, input: { status: "completed" | "partial" | "failed" | "cancelled"; decisions: D.RankedDecision[]; coverage: D.Coverage }): Promise<void>;
  deleteCampaign(userId: D.Id, campaignId: D.Id): Promise<void>;
}

export type WorkerDeps = { repo: DiscoveryRepository; providers: Providers; clock: () => Date; model: (operations: OperationRunner) => CampaignModel; loadExisting: (userId: D.Id, brief: D.Brief) => Promise<D.DiscoveredCandidate[]>; persistQuotes: (lease: Lease, packet: EvidencePacket, raw: D.AnalystOutput | D.SkepticOutput) => Promise<Map<string, D.Citation>>; commitAssessment: (lease: Lease, packet: EvidencePacket, decision: D.CandidateDecision) => Promise<D.AssessedCandidate> };
export type DiscoveryService = {
  createCampaign(userId: D.Id, input: { name: string; question: string }): Promise<D.Campaign>;
  listCampaigns(userId: D.Id, cursor: string | null, limit: number): Promise<D.Page<D.Campaign>>;
  getCampaign(userId: D.Id, campaignId: D.Id): Promise<D.CampaignDetail>;
  draftBrief(userId: D.Id, campaignId: D.Id, expectedVersion: number): Promise<{ brief: D.Brief; base_version: number }>;
  saveBrief(userId: D.Id, campaignId: D.Id, expectedVersion: number, brief: D.Brief): Promise<D.SavedBrief>;
  startRun(userId: D.Id, campaignId: D.Id, input: { brief_version: number; brief_hash: string; request_key: D.Id }): Promise<D.RunRecord>;
  listRuns(userId: D.Id, campaignId: D.Id, cursor: string | null, limit: number): Promise<D.Page<D.RunRecord>>;
  getRun(userId: D.Id, runId: D.Id): Promise<D.RunView>;
  getCandidates(userId: D.Id, runId: D.Id, input: { cursor: string | null; limit: number; state?: D.CandidateState }): Promise<D.Page<D.CandidateView>>;
  getEvents(userId: D.Id, runId: D.Id, after: number): Promise<D.EventPage>;
  cancelRun(userId: D.Id, runId: D.Id): Promise<D.RunRecord>;
  deleteCampaign(userId: D.Id, campaignId: D.Id): Promise<void>;
};

export type DiscoveryDb = QueryExecutor;
