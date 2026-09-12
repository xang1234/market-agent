import type { ThesisMetricCheck } from "../../agents/src/thesis-types.ts";

export type Id = string;
export type Level = "strong" | "mixed" | "weak" | "unknown";
export type RunStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export type Stage = "queued" | "discovery" | "research" | "finalization";
export type CandidateState = "unresolved_identity" | "discovered" | "not_selected" | "researching" |
  "shortlisted" | "eligible_not_shortlisted" | "excluded" | "needs_evidence" | "research_error";
export type Resource = "search" | "document" | "identity" | "financial" | "model";
export type Origin = "seed" | "existing" | "web";
export type Citation = { kind: "claim" | "fact"; id: Id };
export type RawCitation = Citation | { kind: "excerpt"; id: Id; quote: string };
export type DimensionName = "theme_exposure" | "evidence_strength" | "business_quality" | "valuation_context";
export type Dimension<C = Citation> = { level: Level; explanation: string; citations: C[] };
export type Mechanism = { mechanism_id: Id; label: string; chain: string[] };
export type Criterion = {
  criterion_id: Id; importance: "must" | "prefer"; statement: string; falsifier: string;
  metric?: ThesisMetricCheck;
};
export type Brief = {
  schema_version: 1; question: string; market: "us_listed"; horizon_months: number;
  lookback_months: number; mechanisms: Mechanism[]; criteria: Criterion[];
  seed_queries: string[]; exclusions: string[]; preferences: string[];
  queries: { mechanism_id: Id; query: string }[];
};
export type Limits = {
  candidates: 100; research: 25; shortlist: 10; attempts: Record<Resource, number>;
  input_chars: 64000; output_tokens: 10000; request_timeout_ms: 30000; run_timeout_ms: 2700000;
};
export type Campaign = {
  campaign_id: Id; user_id: Id; name: string; question: string; current_brief_version: number;
  created_at: string; updated_at: string; archived_at: string | null;
};
export type SavedBrief = {
  brief_id: Id; campaign_id: Id; version: number; brief: Brief; hash: string;
  approved_at: string | null; created_at: string;
};
export type Coverage = {
  searches_planned: number; searches_completed: number; hits_truncated: number; leads_overflow: number;
  extraction_batches_skipped: number; unresolved: number; discovered: number; selected: number;
  assessed: number; not_selected: number;
  mechanisms: { mechanism_id: Id; discovered: number; selected: number; assessed: number }[];
  gaps: { code: string; candidate_id: Id | null; detail: string }[];
};
export type RunRecord = {
  run_id: Id; campaign_id: Id; brief_id: Id; user_id: Id; status: RunStatus; stage: Stage;
  policy_version: string; request_key: Id; limits: Limits; usage: Record<Resource, number>;
  coverage: Coverage; started_at: string | null; finished_at: string | null; cancel_requested_at: string | null;
};
export type CompanyIdentity = {
  issuer_id: Id; listing_id: Id; legal_name: string; ticker: string; mic: string; currency: string;
  asset_type: "common_stock" | "adr"; identity_source_ids: Id[];
};
export type SearchHit = {
  hit_id: Id; query_index: number; result_index: number; title: string; url: string;
  description: string; retrieved_at: string;
};
export type DiscoveredCandidate = {
  candidate_id: Id; lead_key: string; name: string; identity: CompanyIdentity | null; origins: Origin[];
  mechanism_ids: Id[]; seed: boolean; primary_domain_lead: boolean; first_seen: [number, number];
  lead_hit_ids: Id[]; reason_codes: string[];
};
/** Exact current evidence that permitted reuse of an existing discovery lead. */
export type ExistingEvidenceRef =
  | { kind: "document"; source_id: Id; document_id: Id; claim_id?: Id }
  | { kind: "fact"; source_id: Id; fact_id: Id };
export type ExistingCandidate = DiscoveredCandidate & { evidence_refs: ExistingEvidenceRef[] };
export type CriterionOutcome<C = Citation> = {
  criterion_id: Id; outcome: "pass" | "fail" | "unknown"; explanation: string; citations: C[];
};
export type AnalystOutput<C = RawCitation> = {
  exposure: Dimension<C>; business_quality: Dimension<C>; valuation_context: Dimension<C>;
  criteria: CriterionOutcome<C>[]; unresolved_questions: string[]; next_action: string;
};
export type SkepticOutput<C = RawCitation> = AnalystOutput<C> & {
  counterarguments: { text: string; citations: C[] }[];
};
export type CandidateDecision = {
  candidate_id: Id; identity: CompanyIdentity;
  state: "excluded" | "needs_evidence" | "eligible_not_shortlisted";
  dimensions: Record<DimensionName, Dimension>; criteria: CriterionOutcome[];
  counterarguments: { text: string; citations: Citation[] }[]; unresolved_questions: string[];
  next_action: string; reason_codes: string[];
};
export type AssessedCandidate = { decision: CandidateDecision; snapshot_id: Id };
export type RankedDecision = Omit<CandidateDecision, "state"> & {
  state: "excluded" | "needs_evidence" | "eligible_not_shortlisted" | "shortlisted"; rank: number | null;
};
export type SourceView = { citation: Citation; title: string; url: string; published_at: string | null; retrieved_at: string };
export type CandidateView = {
  candidate_id: Id; identity: CompanyIdentity | null; name: string; state: CandidateState; rank: number | null;
  snapshot_id: Id | null; evidence_available: boolean; can_promote: boolean; assessment: CandidateDecision | null;
  sources: SourceView[]; origins: Origin[]; mechanism_ids: Id[]; reason_codes: string[];
};
export type EventKind = "search_completed" | "lead_resolved" | "document_acquired" |
  "criterion_assessed" | "skeptic_completed" | "budget_exhausted" | "run_resumed" | "run_finalized";
export type CampaignEvent = {
  run_id: Id; sequence: number; stage: Stage; kind: EventKind; candidate_id: Id | null;
  summary: string; citations: Citation[]; created_at: string;
};
export type RunView = RunRecord & { shortlist: CandidateView[]; cost: { status: "unavailable" } };
export type Page<T> = { items: T[]; next_cursor: string | null };
export type EventPage = { items: CampaignEvent[]; next_sequence: number; has_more: boolean };
export type Readiness = { ready: boolean; missing: ("model" | "search" | "reference")[] };
export type CampaignDetail = { campaign: Campaign; brief: SavedBrief | null; latest_run: RunRecord | null; readiness: Readiness };
export type ResearchHandoff = {
  kind: "discovery"; campaignId: Id; runId: Id; candidateId: Id;
  subjectRef: { kind: "issuer" | "listing"; id: Id }; name: string; thesis: string;
  conditions: { statement: string; falsifier: string; horizon: string }[];
};

export type DiscoveryErrorCode =
  | "validation" | "not_found" | "stale_brief" | "active_run" | "request_conflict"
  | "draft_rate_limit" | "unavailable" | "budget_exhausted" | "deadline_exceeded" | "lease_lost" | "cancelled" | "operation_in_progress";

const STATUS_BY_CODE: Record<DiscoveryErrorCode, number> = {
  validation: 400, not_found: 404, stale_brief: 409, active_run: 409, request_conflict: 409,
  draft_rate_limit: 429, unavailable: 503, budget_exhausted: 409, deadline_exceeded: 409,
  lease_lost: 409, cancelled: 409, operation_in_progress: 409,
};

export class DiscoveryError extends Error {
  readonly status: number;
  readonly code: DiscoveryErrorCode;

  constructor(code: DiscoveryErrorCode, message: string) {
    super(message);
    this.name = "DiscoveryError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}
