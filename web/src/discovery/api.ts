import { authenticatedJson, HttpJsonError, type FetchImpl } from "../http/authFetch.ts";
import type {
  Brief,
  Campaign,
  CampaignDetail,
  CandidateDecision,
  CandidateState,
  CandidateView,
  Citation,
  CompanyIdentity,
  Dimension,
  EventPage,
  MetricOption,
  Page,
  RunRecord,
  RunView,
  SavedBrief,
} from "../../../services/discovery/src/types.ts";
import { isExactThresholdInput, type DecimalInput } from "../../../services/agents/src/exact-decimal.ts";

type JsonRecord = Record<string, unknown>;
export type DraftBriefProposal = { brief: Brief; base_version: number };

export async function listCampaigns(args: { userId: string; cursor?: string; fetchImpl?: FetchImpl }): Promise<Page<Campaign>> {
  const search = args.cursor ? `?cursor=${encodeURIComponent(args.cursor)}` : "";
  return request(`/v1/discovery/campaigns${search}`, args, campaignPage);
}

export async function createCampaign(args: { userId: string; name: string; question: string; fetchImpl?: FetchImpl }): Promise<Campaign> {
  return request("/v1/discovery/campaigns", { ...args, method: "POST", body: { name: args.name, question: args.question } }, campaign);
}

export async function getCampaign(args: { userId: string; campaignId: string; signal?: AbortSignal; fetchImpl?: FetchImpl }): Promise<CampaignDetail> {
  return request(`/v1/discovery/campaigns/${encodeURIComponent(args.campaignId)}`, args, campaignDetail);
}

export async function draftBrief(args: {
  userId: string;
  campaignId: string;
  expectedVersion: number;
  signal?: AbortSignal;
  fetchImpl?: FetchImpl;
}): Promise<DraftBriefProposal> {
  return request(`/v1/discovery/campaigns/${encodeURIComponent(args.campaignId)}/draft`, {
    ...args,
    method: "POST",
    body: { expected_version: args.expectedVersion },
  }, draftBriefProposal);
}

export async function saveBrief(args: {
  userId: string;
  campaignId: string;
  expectedVersion: number;
  brief: Brief;
  fetchImpl?: FetchImpl;
}): Promise<SavedBrief> {
  return request(`/v1/discovery/campaigns/${encodeURIComponent(args.campaignId)}/brief`, {
    ...args,
    method: "PUT",
    body: { expected_version: args.expectedVersion, brief: args.brief },
  }, savedBrief);
}

export async function startRun(args: {
  userId: string;
  campaignId: string;
  briefVersion: number;
  briefHash: string;
  requestKey: string;
  signal?: AbortSignal;
  fetchImpl?: FetchImpl;
}): Promise<RunRecord> {
  return request(`/v1/discovery/campaigns/${encodeURIComponent(args.campaignId)}/runs`, {
    ...args,
    method: "POST",
    body: { brief_version: args.briefVersion, brief_hash: args.briefHash, request_key: args.requestKey },
  }, runRecord);
}

export async function listRuns(args: { userId: string; campaignId: string; cursor?: string; fetchImpl?: FetchImpl }): Promise<Page<RunRecord>> {
  const search = args.cursor ? `?cursor=${encodeURIComponent(args.cursor)}` : "";
  return request(`/v1/discovery/campaigns/${encodeURIComponent(args.campaignId)}/runs${search}`, args, runPage);
}

export async function getRun(args: { userId: string; runId: string; signal?: AbortSignal; fetchImpl?: FetchImpl }): Promise<RunView> {
  return request(`/v1/discovery/runs/${encodeURIComponent(args.runId)}`, args, runView);
}

export async function listCandidates(args: {
  userId: string;
  runId: string;
  state?: CandidateState;
  signal?: AbortSignal;
  fetchImpl?: FetchImpl;
}): Promise<Page<CandidateView>> {
  const params = new URLSearchParams({ limit: "100" });
  if (args.state) params.set("state", args.state);
  return request(`/v1/discovery/runs/${encodeURIComponent(args.runId)}/candidates?${params}`, args, candidatePage);
}

export async function listEvents(args: { userId: string; runId: string; after?: number; signal?: AbortSignal; fetchImpl?: FetchImpl }): Promise<EventPage> {
  return request(`/v1/discovery/runs/${encodeURIComponent(args.runId)}/events?after=${args.after ?? 0}`, args, eventPage);
}

export async function cancelRun(args: { userId: string; runId: string; fetchImpl?: FetchImpl }): Promise<RunRecord> {
  return request(`/v1/discovery/runs/${encodeURIComponent(args.runId)}/cancel`, { ...args, method: "POST", body: undefined }, runRecord);
}

export async function listMetricOptions(args: { userId: string; fetchImpl?: FetchImpl }): Promise<MetricOption[]> {
  return request("/v1/discovery/metric-options", args, (value) => array(value, "items").map(metricOption));
}

export function discoveryMessage(error: unknown, fallback: string): string {
  const code = error instanceof HttpJsonError && isRecord(error.body) && typeof error.body.code === "string" ? error.body.code : null;
  if (code === "stale_brief") return "A newer saved brief is available. Your edits are still here; load it only when you are ready.";
  if (code === "active_run") return "A research run is already active for this campaign.";
  if (code === "request_conflict") return "This research request no longer matches the saved brief. Review the brief and try again.";
  if (code === "unavailable") return "Research is not configured right now. Completed work remains available.";
  if (code === "budget_exhausted" || code === "deadline_exceeded") return "Research reached its limit. Review the results that were completed.";
  if (code === "cancelled") return "This research run has already been cancelled.";
  return fallback;
}

async function request<T>(
  path: string,
  args: { userId: string; signal?: AbortSignal; fetchImpl?: FetchImpl; method?: string; body?: unknown },
  decode: (value: unknown) => T,
): Promise<T> {
  const body = await authenticatedJson<unknown>(path, {
    method: args.method,
    signal: args.signal,
    userId: args.userId,
    fetchImpl: args.fetchImpl,
    headers: args.body === undefined ? undefined : { "content-type": "application/json" },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });
  return decode(body);
}

function campaignPage(value: unknown): Page<Campaign> {
  return { items: array(value, "items").map(campaign), next_cursor: nullableString(field(value, "next_cursor")) };
}

function campaign(value: unknown): Campaign {
  const result = object(value, "campaign");
  return {
    campaign_id: string(result, "campaign_id"), user_id: string(result, "user_id"), name: string(result, "name"), question: string(result, "question"),
    current_brief_version: integer(result, "current_brief_version"), created_at: string(result, "created_at"), updated_at: string(result, "updated_at"), archived_at: nullableString(result.archived_at),
  };
}

function campaignDetail(value: unknown): CampaignDetail {
  const result = object(value, "campaign detail");
  return {
    campaign: campaign(result.campaign), brief: result.brief === null ? null : savedBrief(result.brief), latest_run: result.latest_run === null ? null : runRecord(result.latest_run),
    readiness: { ready: boolean(object(result.readiness, "readiness"), "ready"), missing: array(object(result.readiness, "readiness"), "missing").map((item) => stringValue(item, "readiness item")) as CampaignDetail["readiness"]["missing"] },
  };
}

function savedBrief(value: unknown): SavedBrief {
  const result = object(value, "saved brief");
  return {
    brief_id: string(result, "brief_id"), campaign_id: string(result, "campaign_id"), version: integer(result, "version"), brief: brief(result.brief), hash: string(result, "hash"),
    approved_at: nullableString(result.approved_at), created_at: string(result, "created_at"),
  };
}

function draftBriefProposal(value: unknown): DraftBriefProposal {
  const result = object(value, "brief draft");
  return { brief: brief(result.brief), base_version: integer(result, "base_version") };
}

function brief(value: unknown): Brief {
  const result = object(value, "brief");
  const mechanisms = array(result, "mechanisms").map((item) => {
    const row = object(item, "mechanism");
    return { mechanism_id: string(row, "mechanism_id"), label: string(row, "label"), chain: array(row, "chain").map((part) => stringValue(part, "mechanism chain")) };
  });
  const criteria = array(result, "criteria").map((item) => {
    const row = object(item, "criterion");
    const metric = row.metric === undefined ? undefined : object(row.metric, "criterion metric");
    return {
      criterion_id: string(row, "criterion_id"), importance: oneOf(string(row, "importance"), ["must", "prefer"] as const, "criterion importance"),
      statement: string(row, "statement"), falsifier: string(row, "falsifier"),
      ...(metric ? { metric: {
        metric_key: string(metric, "metric_key"), unit: string(metric, "unit"), period_kind: oneOf(string(metric, "period_kind"), ["point", "fiscal_q", "fiscal_y", "ttm"] as const, "metric period"),
        operator: oneOf(string(metric, "operator"), ["eq", "lt", "lte", "gt", "gte"] as const, "metric operator"), threshold: decimal(metric, "threshold"), max_age_days: integer(metric, "max_age_days"),
      } } : {}),
    };
  });
  return {
    schema_version: oneOf(number(result, "schema_version"), [1] as const, "brief schema"), question: string(result, "question"), market: oneOf(string(result, "market"), ["us_listed"] as const, "market"),
    horizon_months: integer(result, "horizon_months"), lookback_months: integer(result, "lookback_months"), mechanisms, criteria,
    seed_queries: array(result, "seed_queries").map((item) => stringValue(item, "seed query")), exclusions: array(result, "exclusions").map((item) => stringValue(item, "exclusion")),
    preferences: array(result, "preferences").map((item) => stringValue(item, "preference")), queries: array(result, "queries").map((item) => {
      const row = object(item, "brief query"); return { mechanism_id: string(row, "mechanism_id"), query: string(row, "query") };
    }),
  };
}

function runPage(value: unknown): Page<RunRecord> { return { items: array(value, "items").map(runRecord), next_cursor: nullableString(field(value, "next_cursor")) }; }

function runRecord(value: unknown): RunRecord {
  const result = object(value, "run");
  const limits = object(result.limits, "limits");
  const attempts = object(limits.attempts, "attempt limits");
  const coverage = object(result.coverage, "coverage");
  return {
    run_id: string(result, "run_id"), campaign_id: string(result, "campaign_id"), brief_id: string(result, "brief_id"), user_id: string(result, "user_id"),
    status: oneOf(string(result, "status"), ["queued", "running", "completed", "partial", "failed", "cancelled"] as const, "run status"),
    stage: oneOf(string(result, "stage"), ["queued", "discovery", "research", "finalization"] as const, "run stage"), policy_version: string(result, "policy_version"), request_key: string(result, "request_key"),
    model_config: array(result, "model_config").map((item) => { const row = object(item, "model configuration"); return { role: oneOf(string(row, "role"), ["planner", "scout", "analyst", "skeptic", "summary"] as const, "model role"), provider: string(row, "provider"), model: string(row, "model"), max_output_tokens: integer(row, "max_output_tokens"), as_of: string(row, "as_of") }; }),
    limits: { candidates: literalNumber(limits, "candidates", 100), research: literalNumber(limits, "research", 25), shortlist: literalNumber(limits, "shortlist", 10), attempts: {
      search: number(attempts, "search"), document: number(attempts, "document"), identity: number(attempts, "identity"), financial: number(attempts, "financial"), model: number(attempts, "model"),
    }, input_chars: literalNumber(limits, "input_chars", 64000), output_tokens: literalNumber(limits, "output_tokens", 10000), request_timeout_ms: literalNumber(limits, "request_timeout_ms", 30000), run_timeout_ms: literalNumber(limits, "run_timeout_ms", 2700000) },
    usage: resourceCounts(result.usage), coverage: {
      searches_planned: integer(coverage, "searches_planned"), searches_completed: integer(coverage, "searches_completed"), hits_truncated: integer(coverage, "hits_truncated"), leads_overflow: integer(coverage, "leads_overflow"), extraction_batches_skipped: integer(coverage, "extraction_batches_skipped"), unresolved: integer(coverage, "unresolved"), discovered: integer(coverage, "discovered"), selected: integer(coverage, "selected"), assessed: integer(coverage, "assessed"), not_selected: integer(coverage, "not_selected"),
      mechanisms: array(coverage, "mechanisms").map((item) => { const row = object(item, "mechanism count"); return { mechanism_id: string(row, "mechanism_id"), discovered: integer(row, "discovered"), selected: integer(row, "selected"), assessed: integer(row, "assessed") }; }),
      gaps: array(coverage, "gaps").map((item) => { const row = object(item, "coverage gap"); return { code: string(row, "code"), candidate_id: nullableString(row.candidate_id), detail: string(row, "detail") }; }),
    },
    started_at: nullableString(result.started_at), finished_at: nullableString(result.finished_at), cancel_requested_at: nullableString(result.cancel_requested_at),
  };
}

function runView(value: unknown): RunView {
  const result = object(value, "run view");
  return { ...runRecord(result), shortlist: array(result, "shortlist").map(candidate), cost: { status: oneOf(string(object(result.cost, "cost"), "status"), ["unavailable"] as const, "cost status") }, worker_waiting: boolean(result, "worker_waiting") };
}

function candidatePage(value: unknown): Page<CandidateView> { return { items: array(value, "items").map(candidate), next_cursor: nullableString(field(value, "next_cursor")) }; }
function candidate(value: unknown): CandidateView {
  const result = object(value, "candidate");
  const sources = array(result, "sources").map((item) => { const row = object(item, "source"); return { citation: citation(row.citation), title: string(row, "title"), url: httpsUrl(row, "url"), published_at: nullableString(row.published_at), retrieved_at: string(row, "retrieved_at") }; });
  return {
    candidate_id: string(result, "candidate_id"), identity: result.identity === null ? null : identity(result.identity), name: string(result, "name"),
    state: oneOf(string(result, "state"), ["unresolved_identity", "discovered", "not_selected", "researching", "shortlisted", "eligible_not_shortlisted", "excluded", "needs_evidence", "research_error"] as const, "candidate state"),
    rank: nullableInteger(result.rank), snapshot_id: nullableString(result.snapshot_id), evidence_available: boolean(result, "evidence_available"), can_promote: boolean(result, "can_promote"), assessment: result.assessment === null ? null : decision(result.assessment),
    sources, origins: array(result, "origins").map((item) => oneOf(stringValue(item, "origin"), ["seed", "existing", "web"] as const, "origin")), mechanism_ids: array(result, "mechanism_ids").map((item) => stringValue(item, "mechanism id")), reason_codes: array(result, "reason_codes").map((item) => stringValue(item, "reason code")),
  };
}

function eventPage(value: unknown): EventPage {
  const result = object(value, "event page");
  return { items: array(result, "items").map((item) => { const row = object(item, "event"); return { run_id: string(row, "run_id"), sequence: integer(row, "sequence"), stage: oneOf(string(row, "stage"), ["queued", "discovery", "research", "finalization"] as const, "event stage"), kind: oneOf(string(row, "kind"), ["search_completed", "lead_resolved", "document_acquired", "criterion_assessed", "skeptic_completed", "budget_exhausted", "run_resumed", "run_finalized"] as const, "event kind"), candidate_id: nullableString(row.candidate_id), summary: string(row, "summary"), citations: array(row, "citations").map(citation), created_at: string(row, "created_at") }; }), next_sequence: integer(result, "next_sequence"), has_more: boolean(result, "has_more") };
}
function metricOption(value: unknown): MetricOption { const row = object(value, "metric option"); return { metric_key: string(row, "metric_key"), display_name: string(row, "display_name"), unit_class: string(row, "unit_class"), aggregation: string(row, "aggregation"), interpretation: string(row, "interpretation"), canonical_source_class: string(row, "canonical_source_class") }; }
function resourceCounts(value: unknown): RunRecord["usage"] { const row = object(value, "usage"); return { search: number(row, "search"), document: number(row, "document"), identity: number(row, "identity"), financial: number(row, "financial"), model: number(row, "model") }; }
function citation(value: unknown): Citation { const row = object(value, "citation"); return { kind: oneOf(string(row, "kind"), ["claim", "fact"] as const, "citation kind"), id: string(row, "id") }; }
function identity(value: unknown): CompanyIdentity { const row = object(value, "identity"); return { issuer_id: string(row, "issuer_id"), listing_id: string(row, "listing_id"), legal_name: string(row, "legal_name"), ticker: string(row, "ticker"), mic: string(row, "mic"), currency: string(row, "currency"), asset_type: oneOf(string(row, "asset_type"), ["common_stock", "adr"] as const, "asset type"), identity_source_ids: array(row, "identity_source_ids").map((item) => stringValue(item, "identity source id")) }; }
function decision(value: unknown): CandidateDecision {
  const row = object(value, "assessment");
  const dimensions = object(row.dimensions, "assessment dimensions");
  return { candidate_id: string(row, "candidate_id"), identity: identity(row.identity), state: oneOf(string(row, "state"), ["excluded", "needs_evidence", "eligible_not_shortlisted"] as const, "assessment state"), dimensions: {
    theme_exposure: dimension(dimensions.theme_exposure), evidence_strength: dimension(dimensions.evidence_strength), business_quality: dimension(dimensions.business_quality), valuation_context: dimension(dimensions.valuation_context),
  }, criteria: array(row, "criteria").map((item) => { const criterion = object(item, "criterion outcome"); return { criterion_id: string(criterion, "criterion_id"), outcome: oneOf(string(criterion, "outcome"), ["pass", "fail", "unknown"] as const, "criterion outcome"), explanation: string(criterion, "explanation"), citations: array(criterion, "citations").map(citation) }; }), counterarguments: array(row, "counterarguments").map((item) => { const counter = object(item, "counterargument"); return { text: string(counter, "text"), citations: array(counter, "citations").map(citation) }; }), unresolved_questions: array(row, "unresolved_questions").map((item) => stringValue(item, "unresolved question")), next_action: string(row, "next_action"), reason_codes: array(row, "reason_codes").map((item) => stringValue(item, "reason code")),
  };
}
function dimension(value: unknown): Dimension { const row = object(value, "assessment dimension"); return { level: oneOf(string(row, "level"), ["strong", "mixed", "weak", "unknown"] as const, "dimension level"), explanation: string(row, "explanation"), citations: array(row, "citations").map(citation) }; }

function object(value: unknown, label: string): JsonRecord { if (!isRecord(value)) throw new Error(`Invalid ${label} response.`); return value; }
function isRecord(value: unknown): value is JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value); }
function field(value: unknown, key: string): unknown { return object(value, "response")[key]; }
function array(value: unknown, key: string): unknown[] { const result = object(value, "response")[key]; if (!Array.isArray(result)) throw new Error(`Invalid ${key} response.`); return result; }
function string(row: JsonRecord, key: string): string { return stringValue(row[key], key); }
function stringValue(value: unknown, label: string): string { if (typeof value !== "string") throw new Error(`Invalid ${label} response.`); return value; }
function number(row: JsonRecord, key: string): number { const value = row[key]; if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${key} response.`); return value; }
function integer(row: JsonRecord, key: string): number { const value = number(row, key); if (!Number.isInteger(value)) throw new Error(`Invalid ${key} response.`); return value; }
function literalNumber<T extends number>(row: JsonRecord, key: string, expected: T): T { if (number(row, key) !== expected) throw new Error(`Invalid ${key} response.`); return expected; }
function boolean(row: JsonRecord, key: string): boolean { if (typeof row[key] !== "boolean") throw new Error(`Invalid ${key} response.`); return row[key]; }
function nullableString(value: unknown): string | null { if (value === null) return null; return stringValue(value, "nullable string"); }
function nullableInteger(value: unknown): number | null { if (value === null) return null; if (typeof value !== "number" || !Number.isInteger(value)) throw new Error("Invalid number response."); return value; }
function oneOf<T extends string | number>(value: string | number, choices: readonly T[], label: string): T { if (!choices.includes(value as T)) throw new Error(`Invalid ${label} response.`); return value as T; }
function decimal(row: JsonRecord, key: string): DecimalInput {
  const value = field(row, key);
  if (!isExactThresholdInput(value)) throw new Error("Invalid exact decimal response.");
  return value;
}
function httpsUrl(row: JsonRecord, key: string): string {
  const value = string(row, key);
  try {
    if (new URL(value).protocol !== "https:") throw new Error("non-HTTPS URL");
    return value;
  } catch {
    throw new Error("Invalid source URL response.");
  }
}
