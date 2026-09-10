# Discovery campaigns: execution contracts

Companion to the [implementation plan](2026-09-10-discovery-campaigns.md) and [approved spec](../specs/2026-09-10-discovery-campaigns-design.md). Task1 owns these types. Type names and parameter ordering below are the integration contract; implementation may split files while preserving exports. All IDs are UUIDs validated at boundaries. All persisted timestamps are ISO8601 UTC. No source credentials appear in DTOs or persisted model configuration snapshots.

## Browser-safe domain types (`services/discovery/src/types.ts`)

```ts
import type {ThesisMetricCheck} from '../../agents/src/thesis-types.ts';
export type Id = string;
export type Level = 'strong'|'mixed'|'weak'|'unknown';
export type RunStatus = 'queued'|'running'|'completed'|'partial'|'failed'|'cancelled';
export type Stage = 'queued'|'discovery'|'research'|'finalization';
export type CandidateState = 'unresolved_identity'|'discovered'|'not_selected'|'researching'|
  'shortlisted'|'eligible_not_shortlisted'|'excluded'|'needs_evidence'|'research_error';
export type Resource = 'search'|'document'|'identity'|'financial'|'model';
export type Origin = 'seed'|'existing'|'web';
export type Citation = {kind:'claim'|'fact';id:Id};
export type RawCitation = Citation|{kind:'excerpt';id:Id;quote:string};
export type DimensionName = 'theme_exposure'|'evidence_strength'|'business_quality'|'valuation_context';
export type Dimension<C = Citation> = {level:Level;explanation:string;citations:C[]};
export type Mechanism = {mechanism_id:Id;label:string;chain:string[]};
export type Criterion = {
  criterion_id:Id;importance:'must'|'prefer';statement:string;falsifier:string;
  metric?:ThesisMetricCheck;
};
export type Brief = {
  schema_version:1;question:string;market:'us_listed';horizon_months:number;
  lookback_months:number;mechanisms:Mechanism[];criteria:Criterion[];
  seed_queries:string[];exclusions:string[];preferences:string[];
  queries:{mechanism_id:Id;query:string}[];
};
export type Limits = {
  candidates:100;research:25;shortlist:10;
  attempts:Record<Resource,number>;input_chars:64000;output_tokens:10000;
  request_timeout_ms:30000;run_timeout_ms:2700000;
};
export type Campaign = {
  campaign_id:Id;user_id:Id;name:string;question:string;current_brief_version:number;
  created_at:string;updated_at:string;archived_at:string|null;
};
export type SavedBrief = {
  brief_id:Id;campaign_id:Id;version:number;brief:Brief;hash:string;
  approved_at:string|null;created_at:string;
};
export type Coverage = {
  searches_planned:number;searches_completed:number;hits_truncated:number;
  leads_overflow:number;extraction_batches_skipped:number;unresolved:number;
  discovered:number;selected:number;assessed:number;not_selected:number;
  mechanisms:{mechanism_id:Id;discovered:number;selected:number;assessed:number}[];
  gaps:{code:string;candidate_id:Id|null;detail:string}[];
};
export type RunRecord = {
  run_id:Id;campaign_id:Id;brief_id:Id;user_id:Id;status:RunStatus;stage:Stage;
  policy_version:string;request_key:Id;limits:Limits;usage:Record<Resource,number>;
  coverage:Coverage;started_at:string|null;finished_at:string|null;
  cancel_requested_at:string|null;
};
export type CompanyIdentity = {
  issuer_id:Id;listing_id:Id;legal_name:string;ticker:string;mic:string;
  currency:string;asset_type:'common_stock'|'adr';identity_source_ids:Id[];
};
export type SearchHit = {
  hit_id:Id;query_index:number;result_index:number;title:string;url:string;
  description:string;retrieved_at:string;
};
export type DiscoveredCandidate = {
  candidate_id:Id;lead_key:string;name:string;identity:CompanyIdentity|null;
  origins:Origin[];mechanism_ids:Id[];seed:boolean;primary_domain_lead:boolean;
  first_seen:[number,number];lead_hit_ids:Id[];reason_codes:string[];
};
export type CriterionOutcome<C = Citation> = {
  criterion_id:Id;outcome:'pass'|'fail'|'unknown';explanation:string;citations:C[];
};
export type AnalystOutput<C = RawCitation> = {
  exposure:Dimension<C>;business_quality:Dimension<C>;
  valuation_context:Dimension<C>;criteria:CriterionOutcome<C>[];
  unresolved_questions:string[];next_action:string;
};
export type SkepticOutput<C = RawCitation> = {
  exposure:Dimension<C>;business_quality:Dimension<C>;
  valuation_context:Dimension<C>;criteria:CriterionOutcome<C>[];
  counterarguments:{text:string;citations:C[]}[];
  unresolved_questions:string[];next_action:string;
};
export type CandidateDecision = {
  candidate_id:Id;identity:CompanyIdentity;state:'excluded'|'needs_evidence'|'eligible_not_shortlisted';
  dimensions:Record<DimensionName,Dimension>;criteria:CriterionOutcome[];
  counterarguments:{text:string;citations:Citation[]}[];unresolved_questions:string[];
  next_action:string;reason_codes:string[];
};
export type AssessedCandidate = {decision:CandidateDecision;snapshot_id:Id};
export type RankedDecision = Omit<CandidateDecision,'state'>&{
  state:'excluded'|'needs_evidence'|'eligible_not_shortlisted'|'shortlisted';rank:number|null;
};
export type SourceView = {citation:Citation;title:string;url:string;published_at:string|null;retrieved_at:string};
export type CandidateView = {
  candidate_id:Id;identity:CompanyIdentity|null;name:string;state:CandidateState;
  rank:number|null;snapshot_id:Id|null;evidence_available:boolean;can_promote:boolean;
  assessment:CandidateDecision|null;sources:SourceView[];origins:Origin[];mechanism_ids:Id[];reason_codes:string[];
};
export type EventKind = 'search_completed'|'lead_resolved'|'document_acquired'|
  'criterion_assessed'|'skeptic_completed'|'budget_exhausted'|'run_resumed'|'run_finalized';
export type CampaignEvent = {
  run_id:Id;sequence:number;stage:Stage;kind:EventKind;candidate_id:Id|null;
  summary:string;citations:Citation[];created_at:string;
};
export type RunView = RunRecord&{shortlist:CandidateView[];cost:{status:'unavailable'}};
export type Page<T> = {items:T[];next_cursor:string|null};
export type EventPage = {items:CampaignEvent[];next_sequence:number;has_more:boolean};
export type Readiness = {ready:boolean;missing:('model'|'search'|'reference')[]};
export type CampaignDetail = {campaign:Campaign;brief:SavedBrief|null;latest_run:RunRecord|null;readiness:Readiness};
export type ResearchHandoff = {
  kind:'discovery';campaignId:Id;runId:Id;candidateId:Id;
  subjectRef:{kind:'issuer'|'listing';id:Id};name:string;thesis:string;
  conditions:{statement:string;falsifier:string;horizon:string}[];
};
```

Task1 exports a `DiscoveryError` with `code`, `status`, `message`. Codes/statuses: validation400; not_found404; stale_brief409; active_run409; request_conflict409; draft_rate_limit429; unavailable503; budget_exhausted409; deadline_exceeded409; lease_lost409; cancelled409. Worker control errors are not exposed as raw stack traces. Typed budget exhaustion becomes a partial terminal run, not an endless HTTP retry.

Validation: name1–120, question20–4,000; horizon1–60 months and lookback1–24 integer months; mechanisms2–4 with unique UUID IDs, label1–160 and chain2–5 strings each1–300; criteria1–8 with unique UUID IDs, statement/falsifier8–1,000 characters; seeds0–5 strings1–200; exclusions/preferences0–10 strings1–300; queries1–20, each1–600 characters and at most75 whitespace-separated words, every mechanism represented. All referenced mechanism IDs must exist. Metric criteria use the existing `ThesisMetricCheck` validation and supported catalog; no arbitrary provider field. Unknown JSON keys fail. IDs are assigned by the server for model-generated proposals; user edits retain IDs. Hash a normalized JSON value with the existing canonical hash utility; do not hash object insertion order. Arrays' order is significant in the approved brief.

Unknown explanatory fields must say what is missing; unknown dimensions must not contain a number invented from absent facts. Cap each role's complete serialized response at100,000 characters before parsing, each explanation/next-action at2,000, questions0–8 at500 each, counterarguments0–8 at2,000 each, citations0–12 per field. These are validation limits, separate from10,000 output tokens. Empty citation lists are allowed only for explicit unknown/coverage statements. All positive or negative factual assertions require supplied citations.

## Backend ports (`services/discovery/src/ports.ts`)

Keep raw excerpts and model outputs in backend modules. Never return EvidencePacket through public HTTP.

```ts
import type {QueryExecutor} from '../../agents/src/agent-repo.ts';
import type {LlmChatMessage,LlmRouterResult} from '../../llm/src/router.ts';
import type {ThesisFact} from '../../agents/src/thesis-evaluator.ts';
import type * as D from './types.ts';
export type Lease = {run_id:D.Id;user_id:D.Id;worker_id:string;epoch:number;expires_at:string};
export type Checkpoint = {
  version:1;stage:D.Stage;cohort:D.Id[];next_company:number;
  completed_operation_keys:string[];
};
export type Excerpt = {
  excerpt_id:D.Id;document_id:D.Id;source_id:D.Id;family_key:string;title:string;url:string;
  published_at:string|null;retrieved_at:string;document_hash:string;
  normalized_start:number;text:string;primary:boolean;primary_eligible:boolean;
};
export type PacketFact = ThesisFact&{
  fiscal_year:number|null;fiscal_period:string|null;period_start:string|null;
};
export type EvidencePacket = {
  candidate_id:D.Id;identity:D.CompanyIdentity;excerpts:Excerpt[];
  claims:{claim_id:D.Id;document_id:D.Id;source_id:D.Id;text_canonical:string}[];
  facts:PacketFact[];counter_search_completed:boolean;coverage_gaps:string[];
};
export type OperationContext = {signal:AbortSignal;attempt_number:1|2};
export type OperationRunner = {
  run<T>(input:{key:string;resource:D.Resource;phase:'discovery'|'research'|'verification';
    candidate_id?:D.Id;execute:(ctx:OperationContext)=>Promise<T>}):Promise<T>;
  providerAttempt<T>(input:{key:string;index:0|1;resource:'model';
    execute:(signal:AbortSignal)=>Promise<T>}):Promise<T>;
};
export type CampaignModel = {
  complete(input:{operation_key:string;role:'planner'|'scout'|'analyst'|'skeptic'|'summary';
    messages:LlmChatMessage[]}):Promise<LlmRouterResult>;
};
export type SearchProvider = {
  search(input:{query:string;query_index:number},operations:OperationRunner):Promise<D.SearchHit[]>;
};
export type IdentityProvider = {
  resolve(input:{query:string;hit_ids:D.Id[]},operations:OperationRunner):Promise<
    {status:'resolved';identity:D.CompanyIdentity}|{status:'unresolved';reason:string}>;
};
export type EvidenceProvider = {
  acquire(input:{brief:D.Brief;candidate:D.DiscoveredCandidate;as_of:string},operations:OperationRunner):Promise<EvidencePacket>;
};
export type FinancialProvider = {
  read(input:{identity:D.CompanyIdentity;as_of:string},operations:OperationRunner):Promise<PacketFact[]>;
};
export type Providers = {search:SearchProvider;identity:IdentityProvider;evidence:EvidenceProvider;financials:FinancialProvider};
export type DiscoveryContext = {
  brief:D.Brief;providers:Providers;model:CampaignModel;operations:OperationRunner;
  existing:D.DiscoveredCandidate[];admit:(candidate:D.DiscoveredCandidate)=>Promise<void>;
};
export type DiscoveryPool = {candidates:D.DiscoveredCandidate[];coverage:D.Coverage};
export type AssessmentContext = {
  brief:D.Brief;packet:EvidencePacket;model:CampaignModel;as_of:string;
  persistQuotes:(raw:D.AnalystOutput|D.SkepticOutput)=>Promise<Map<string,D.Citation>>;
};
export type AttemptReservation = {
  attempt_id:D.Id;attempt_number:1|2;
  state:'dispatch'|'cached'|'exhausted';result:unknown;
};
export type StoredCandidate = D.DiscoveredCandidate&{
  state:D.CandidateState;ordinal:number|null;assessment:D.CandidateDecision|null;
  snapshot_id:D.Id|null;rank:number|null;
};
export interface DiscoveryRepository {
  createCampaign(userId:D.Id,input:{name:string;question:string}):Promise<D.Campaign>;
  getCampaign(userId:D.Id,campaignId:D.Id):Promise<D.Campaign>;
  listCampaigns(userId:D.Id,cursor:string|null,limit:number):Promise<D.Page<D.Campaign>>;
  getBrief(userId:D.Id,briefId:D.Id):Promise<D.SavedBrief>;
  currentBrief(userId:D.Id,campaignId:D.Id):Promise<D.SavedBrief|null>;
  saveBrief(userId:D.Id,campaignId:D.Id,expectedVersion:number,brief:D.Brief):Promise<D.SavedBrief>;
  startRun(userId:D.Id,campaignId:D.Id,input:{brief_version:number;brief_hash:string;request_key:D.Id}):Promise<D.RunRecord>;
  readRun(userId:D.Id,runId:D.Id):Promise<D.RunRecord>;
  listRuns(userId:D.Id,campaignId:D.Id,cursor:string|null,limit:number):Promise<D.Page<D.RunRecord>>;
  claimNextRun(workerId:string):Promise<Lease|null>;
  heartbeat(lease:Lease):Promise<Lease>;
  checkpoint(lease:Lease):Promise<Checkpoint>;
  saveCheckpoint(lease:Lease,checkpoint:Checkpoint):Promise<void>;
  candidates(userId:D.Id,runId:D.Id):Promise<StoredCandidate[]>;
  admitCandidate(lease:Lease,candidate:D.DiscoveredCandidate):Promise<void>;
  commitCohort(lease:Lease,candidateIds:D.Id[],coverage:D.Coverage):Promise<void>;
  failCandidate(lease:Lease,candidateId:D.Id,code:string):Promise<void>;
  reserveAttempt(scope:Lease|{campaign_id:D.Id;user_id:D.Id;draft_token:D.Id},input:{
    operation_key:string;request_hash:string;resource:D.Resource;phase:'draft'|'discovery'|'research'|'verification';
    candidate_id?:D.Id;attempt_number:1|2}):Promise<AttemptReservation>;
  finishAttempt(scope:Lease|{campaign_id:D.Id;user_id:D.Id;draft_token:D.Id},input:{
    attempt_id:D.Id;outcome:'success'|'error'|'unknown';result:unknown;tool_call_id:D.Id|null}):Promise<void>;
  getOperation(userId:D.Id,runId:D.Id,key:string):Promise<{outcome:string;result:unknown}|null>;
  acquireDraft(userId:D.Id,campaignId:D.Id,requestId:D.Id):Promise<{draft_token:D.Id;expires_at:string}>;
  releaseDraft(userId:D.Id,campaignId:D.Id,token:D.Id):Promise<void>;
  appendEvent(lease:Lease,event:Omit<D.CampaignEvent,'run_id'|'sequence'|'created_at'>):Promise<void>;
  events(userId:D.Id,runId:D.Id,after:number,limit:number):Promise<D.EventPage>;
  requestCancel(userId:D.Id,runId:D.Id):Promise<D.RunRecord>;
  finalize(lease:Lease,input:{status:'completed'|'partial'|'failed'|'cancelled';
    decisions:D.RankedDecision[];coverage:D.Coverage}):Promise<void>;
  deleteCampaign(userId:D.Id,campaignId:D.Id):Promise<void>;
}
export type WorkerDeps = {
  repo:DiscoveryRepository;providers:Providers;clock:()=>Date;
  model:(operations:OperationRunner)=>CampaignModel;
  loadExisting:(userId:D.Id,brief:D.Brief)=>Promise<D.DiscoveredCandidate[]>;
  persistQuotes:(lease:Lease,packet:EvidencePacket,raw:D.AnalystOutput|D.SkepticOutput)=>Promise<Map<string,D.Citation>>;
  commitAssessment:(lease:Lease,packet:EvidencePacket,decision:D.CandidateDecision)=>Promise<D.AssessedCandidate>;
};
export type DiscoveryService = {
  createCampaign(userId:D.Id,input:{name:string;question:string}):Promise<D.Campaign>;
  listCampaigns(userId:D.Id,cursor:string|null,limit:number):Promise<D.Page<D.Campaign>>;
  getCampaign(userId:D.Id,campaignId:D.Id):Promise<D.CampaignDetail>;
  draftBrief(userId:D.Id,campaignId:D.Id,expectedVersion:number):Promise<{brief:D.Brief;base_version:number}>;
  saveBrief(userId:D.Id,campaignId:D.Id,expectedVersion:number,brief:D.Brief):Promise<D.SavedBrief>;
  startRun(userId:D.Id,campaignId:D.Id,input:{brief_version:number;brief_hash:string;request_key:D.Id}):Promise<D.RunRecord>;
  listRuns(userId:D.Id,campaignId:D.Id,cursor:string|null,limit:number):Promise<D.Page<D.RunRecord>>;
  getRun(userId:D.Id,runId:D.Id):Promise<D.RunView>;
  getCandidates(userId:D.Id,runId:D.Id,input:{cursor:string|null;limit:number;state?:D.CandidateState}):Promise<D.Page<D.CandidateView>>;
  getEvents(userId:D.Id,runId:D.Id,after:number):Promise<D.EventPage>;
  cancelRun(userId:D.Id,runId:D.Id):Promise<D.RunRecord>;
  deleteCampaign(userId:D.Id,campaignId:D.Id):Promise<void>;
};
```

`unknown` is used only for persisted provider response blobs and parsers' untrusted inputs; decode/validate before returning a cached operation result. Cache identity includes request hash, role/prompt version, brief id/hash and candidate identity. Reusing an operation key with a changed request fails; it does not return another request's cached result.

Factories/signatures implemented by their owning tasks:

```ts
// Task1
createDiscoveryRepository(db:QueryExecutor,options:{clock:()=>Date}):DiscoveryRepository;
parseBrief(value:unknown):Brief;
validateModelRequest(messages:LlmChatMessage[],maxTokens:number):void;
// Task2
createOperationRunner(repo:DiscoveryRepository,lease:Lease,signal:AbortSignal):OperationRunner;
createCampaignModel(router:ControlledRouter,operations:OperationRunner):CampaignModel;
// Task3
createBraveSearchProvider(options:{apiKey:string;fetch:typeof fetch}):SearchProvider;
// Task4
// DiscoveryPool contains actual admitted rows, not every unpersisted model suggestion.
discoverCandidates(context:DiscoveryContext):Promise<DiscoveryPool>;
chooseResearchCohort(brief:Brief,candidates:DiscoveredCandidate[]):Id[];
// Task5
validateAnalystOutput(value:unknown,brief:Brief,packet:EvidencePacket):AnalystOutput;
validateSkepticOutput(value:unknown,brief:Brief,packet:EvidencePacket):SkepticOutput;
assessCompany(context:AssessmentContext):Promise<CandidateDecision>;
normalizeRoleCitations<C extends AnalystOutput|SkepticOutput>(raw:C,quotes:Map<string,Citation>):
  C extends SkepticOutput ? SkepticOutput<Citation> : AnalystOutput<Citation>;
decideCandidate(brief:Brief,packet:EvidencePacket,analyst:AnalystOutput<Citation>,
  skeptic:SkepticOutput<Citation>,asOf:string):CandidateDecision;
rankShortlist(decisions:CandidateDecision[]):RankedDecision[];
sealCandidateAssessment(tx:QueryExecutor,input:{packet:EvidencePacket;decision:CandidateDecision;
  as_of:string;tool_call_ids:Id[]}):Promise<Id>;
// Task6
executeDiscoveryRun(deps:WorkerDeps,lease:Lease,signal:AbortSignal):Promise<void>;
runDiscoveryWorker(deps:WorkerDeps,options:{signal:AbortSignal;pollMs:number}):Promise<void>;
```

These signature blocks are a contract checklist, not a directly executable standalone source file: backend imports above provide the referenced types. Implementers copy the domain type blocks to their canonical modules and implement the factories in the files assigned by the plan. A compile-only contract test imports every exported factory and checks its type against the companion before downstream tasks merge.

## Model control contract (additive to existing router)

```ts
export type LlmExecutionControls = {
  signal?:AbortSignal;
  maxAttempts?:number;
  beforeAttempt?:(attempt:{index:number;channel:string;model:string})=>Promise<void>;
  executeAttempt?: (attempt:{index:number;channel:string;model:string},
    dispatch:()=>Promise<LlmChatResult>)=>Promise<LlmChatResult>;
};
export type ControlledRouter = {
  complete(request:LlmChatRequest,controls?:LlmExecutionControls):Promise<LlmRouterResult>;
};
```

`beforeAttempt` remains useful for clients with admission-only control. Campaigns use `executeAttempt` to wrap the real provider invocation with reservation and durable outcome recording. The router calls both controls outside the provider catch that decides fallbacks: admission/storage/control errors must propagate, whereas errors thrown by the actual provider retain existing provider classification. Implement this distinction with a dedicated provider-dispatch wrapper, not a catch-all around the hook. Limit2 actual attempts per logical operation. A malformed successful response may use the second attempt as a repair only if one actual attempt remains; it does not reset the attempt counter. The operation's cached validated output is reused on restart before any new provider dispatch.

Add optional `signal` to the client execution options and the Pi completion options, passing it through to the installed SDK; preserve existing signatures' optional compatibility. Validate actual SDK support locally. An SDK incapable of aborting is not eligible for campaign execution until its adapter supports cancellation. A failed deadline does not authorize a background provider request to keep spawning follow-ups.

## Decision and quote normalization details

1. Validate each role's entire schema, all criterion IDs exactly once, citation membership and exact quote locations.
2. Build a quote key as a canonical hash of document id, document hash, excerpt normalized offset and normalized quote. `persistQuotes` stores the exact source quote and evidence locator, and returns quote-key→claim Citation. A repeated quote never changes its source or source text. Use the existing claim/evidence repository, with operation-key idempotency recorded before stage advancement.
3. `normalizeRoleCitations` rewrites every excerpt citation using the persisted quote map, rejecting a missing mapping. `decideCandidate` accepts only normalized role objects and returns normalized claim/fact citations. Reload the packet claims after quote persistence and before decision evaluation. For a fixture exercising a valid admission, supply both the excerpt and its exact-quote claim in `packetFixture` and use claim citations in the role fixtures. The missing-primary test still has that claim but loses primary eligible excerpts and fails the gate.
4. For each narrative must-have: both passes → pass; both evidence-backed fails → fail; disagreement or either unknown → unknown. A numerical criterion uses the shared deterministic metric evaluation and overrides narrative opinions. Task1 validates its shape through `parseThesisConditions` and verifies its `metric_key` against the canonical `metrics` registry; it does not invent a static metric whitelist or require a candidate-specific value at brief-save time. Any confirmed required failure excludes; otherwise any unknown required result needs_evidence.
5. Compute theme_exposure and business_quality conservatively from the two roles (strong>mixed>weak>unknown). Keep valuation unknown if no eligible valuation evidence; otherwise apply the same conservative combination for context only. Exposure must be strong or mixed and linked to current primary eligible evidence; citations to primary text must actually be used by both roles' exposure assessment, not merely present in the packet. Counter-search must have completed, and Skeptic must have supplied a valid assessment. These checks precede ranking.
6. Evidence strength: qualifying primary-only support→mixed; plus another distinct substantive document with a validated supporting or contrary citation→strong. Same content hash, canonical URL or explicitly recorded syndication family counts once. Do not count a source merely because it was downloaded.
7. Sort eligible decisions by exposure, evidence strength, business quality (order strong,mixed,weak,unknown), then issuer UUID using binary/string comparison. First10 become shortlisted; other eligible remain eligible_not_shortlisted. Preserve excluded/needs_evidence in the ledger with null rank. Recheck current eligibility/visibility before finalization; a revoked source cannot sneak into final rank.
8. A missing-data statement may have no citations but cannot add factual numerical prose. Normalize citation quotes before sealing. The semantic limitation remains explicit: exact quote/ID checks cannot prove the model's interpretation; the independent challenge, conservative disagreement rules and human fixture review are complementary controls.

## Repository storage contract

Task1 translates these columns to explicit DDL and TypeScript row mappers; the types above are external DTOs, so internal lease/operation JSON must never be spread into them. Use text status columns with CHECK constraints rather than inventing project-wide enums. All JSON arrays/objects have the correct JSONB-type CHECK; validated writes enforce bounded lengths and numeric values.

| Table | Required columns and constraints |
|---|---|
| discovery_campaigns | campaign_id UUID PK, user_id UUID FK users ON DELETE CASCADE, name text, question text, current_brief_version integer default0 CHECK>=0, archived_at timestamptz nullable, draft_lock_token UUID nullable, draft_lock_until timestamptz nullable, created_at/updated_at default now(); UNIQUE(campaign_id,user_id) |
| discovery_briefs | brief_id UUID PK, campaign_id FK campaigns CASCADE, version integer CHECK>0, brief jsonb object, content_hash text, approved_at nullable, created_at; UNIQUE(campaign_id,version), UNIQUE(brief_id,campaign_id) |
| discovery_runs | run_id UUID PK, campaign_id UUID, user_id UUID, brief_id UUID, request_key UUID, status/stage checked, policy_version text, model_config jsonb array (channel/model only), limits/usage/phase_usage/checkpoint/coverage jsonb objects, lease_owner text nullable, lease_epoch bigint default0, lease_expires_at nullable, next_event_sequence bigint default0, cancel_requested_at/started_at/finished_at nullable, created_at; composite FK(campaign_id,user_id)→campaigns CASCADE; composite FK(brief_id,campaign_id)→briefs RESTRICT; UNIQUE(run_id,campaign_id); active user and request-key indices from plan |
| discovery_candidates | candidate_id UUID PK, run_id FK runs CASCADE, lead_key text, issuer_id UUID FK issuers nullable, listing_id UUID FK listings nullable, identity_display jsonb object nullable, origins/mechanisms/lead_hit_ids/reason_codes jsonb arrays, first_seen jsonb array length2, seed boolean, primary_domain_lead boolean, name text, state checked, selection_ordinal integer nullable CHECK1..25, analyst_output/skeptic_output/assessment jsonb objects nullable, snapshot_id UUID FK snapshots nullable, rank integer nullable CHECK1..10, created_at/updated_at; unique run/issuer, run/lead_key, run/rank; CHECK issuer_id and listing_id either both null or both non-null |
| discovery_attempts | attempt_id UUID PK, campaign_id FK campaigns CASCADE, run_id UUID nullable, operation_key text, request_hash text, attempt_number integer CHECK IN(1,2), resource/phase checked, candidate_id FK candidates CASCADE nullable, outcome checked reserved/success/error/unknown, result jsonb nullable, result_hash text nullable, tool_call_id UUID nullable, reserved_at/completed_at; composite FK(run_id,campaign_id)→runs CASCADE; UNIQUE(campaign_id,operation_key,attempt_number) |
| discovery_events | run_id FK runs CASCADE, sequence bigint CHECK>0, candidate_id FK candidates CASCADE nullable, stage/event_kind checked, summary text, citation_refs jsonb array, learning_concept_id text nullable, created_at; PRIMARY KEY(run_id,sequence) |

No FK to partitioned tool_call_logs unless its existing key permits it; retain its canonical ID/hash and validate via existing snapshot/tool-log code. Link role/operation logs to user/campaign/run metadata for lifecycle redaction/removal. No secret-bearing prompt configuration is persisted.

`source-derived attempt result` may contain protected excerpts; do not duplicate full raw documents into it. Store document references/hash/offsets and bounded role/scout outputs needed for resume. Reload excerpts through the evidence boundary, with current rights. On source revocation before resume, fail/reacquire only within remaining budget; do not replay private cached text. Finalization verifies rank uniqueness/contiguity and limits in one transaction.

Deletion order: under user+campaign locks, refuse a live lease, delete campaign-owned rows (or cascade), then remove only newly unreferenced snapshots and discovery-owned log entries. A revoked source never changes an immutable snapshot's content; authorized views redact access instead. User erasure already locks the user/sources in `services/evidence/src/blob-gc-repo.ts`; add the discovery-owned cleanup there before deleting the user. Every worker state write joins/locks the user row before the run to match that lock order and avoid resurrection. Do not acquire source locks in the inverse order.

Operation key format: `<run UUID>/<stage>/<candidate UUID or pool>/<purpose>`, with a canonical request hash checked on reuse. Draft uses `draft/<request UUID>` scoped to campaign; save its expected brief version in request hash. Attempt number1 and2 share that operation key; a repair is not a new unrelated operation. Discovery query keys include the approved query index; counter-search keys include candidate and query purpose. Budget phase_usage enforces discovery20/research50/verification10 search allocations within overall80, with retries charged to verification rather than silently increasing an initial allocation.

Post-discovery model reservation floor is two times the number of selected companies whose initial Analyst/Skeptic attempt is not yet reserved. Mandatory initial attempts reduce this floor; optional retry/summary calls can run only if usage+1+floor<=64. If a company cannot be researched because acquisition failed, mark the company research_error and release its unconsumed floor slots, not already charged attempts. The run still records incomplete planned research.

## Public route responses and pagination

The API request bodies are in spec §10. Campaign/brief/run methods return the named DTO directly, except listing endpoints return Page<T>. Event pages default100, maximum200; candidate pages default25, maximum100; campaign/run lists default20, maximum100. Reject invalid/negative cursors. Encode a cursor as opaque base64url JSON `{created_at,id}` for newest-first campaign/run lists; candidate pagination uses candidate_id ascending and filters state before page size. Cursors are validated as data and parameterized in SQL. Event `after_sequence` is nonnegative integer and never a timestamp.

A `GET run` view includes only shortlisted CandidateViews and aggregate coverage; full details for other states come from candidates. If shortlisted evidence was revoked, retain a redacted CandidateView with `assessment:null`, `evidence_available:false`, `can_promote:false`, even if historical state/rank remains. No result endpoint returns model prompts, attempts.result, document bytes or lease internals.

Exports and promotions use the existing GET run/candidates endpoints immediately before acting; no new mutation endpoint is needed. Task9 must not add undisclosed `DiscoveryService.export`/`handoff` methods. It validates returned current views, then formats/navigation-prefills locally. A page reload discards in-memory draft handoff state unless the user explicitly saves it through existing agent/thesis actions.

## Test-fixture helpers and build setup

Task1 package scripts: `test: node --experimental-strip-types --test 'test/**/*.test.ts'`; `worker: node --experimental-strip-types src/worker-cli.ts`. Depend on the existing pg version and @types/pg used by adjacent services; no new library beyond that existing dependency. Use native Node test and shared Docker/PostgreSQL harness.

Task1 exports test factories with these signatures: `briefFixture():Brief`; `identityFixture(index=0):CompanyIdentity`; `packetFixture():EvidencePacket`; `analystFixture():AnalystOutput`; `skepticFixture():SkepticOutput`. `identityFixture(index)` varies the final12 hex digits of valid issuer/listing UUIDs, legal_name and ticker while retaining MIC XNAS, USD and common_stock. The default candidate_id is `90000000-0000-4000-8000-000000000001`. Excerpt id is `a0000000-0000-4000-8000-000000000001`; second mechanism id is `40000000-0000-4000-8000-000000000002`. The first source quote is present in both packet excerpt and packet claim. Default roles cite that claim and return exposure strong, business_quality unknown and valuation_context unknown, with the single criterion pass. Skeptic counterargument uses the second risk excerpt with a separate claim ID. All fixture calls deep-copy nested values.

The db harness seeds the users only by default. Tests that seal facts/claims or resolve identities insert the relevant issuer/instrument/listing/source/document rows using existing repository factories and exact UUIDs. `clock` exposes `now():Date` and `advance(ms):void`, and the repository gets `clock:()=>clock.now()`. The runner harness reuses this clock; no real waits for45-minute expiry tests.

## Remaining deployment inputs (not unresolved product design)

- Operator supplies `DISCOVERY_SEARCH_API_KEY`, existing reference-provider credentials, existing permitted SEC user-agent settings and a configured model deployment supporting the approved response/context ceilings.
- First adapter is Brave; swapping a provider requires an adapter contract test, not changing campaign criteria/types.
- Worker must run alongside API and be supervised. Existing `scripts/dev-shell.sh` is the local integration point; production process supervision is configured by the deployment owner.
- Human evaluation is an explicit release gate after implementation, not a prerequisite to writing code or this plan. An absent provider key must not be worked around by scraping a consumer UI, fabricating data, or making unapproved paid subscriptions.

## Transaction and resume invariants

`assessCompany` validates and normalizes both roles, persists exact quote claims, and returns an unsealed decision. Task5 implements `commitAssessment` as the worker dependency: acquire user/run locks, check live lease epoch and cancellation, call `sealCandidateAssessment` using that same transaction, persist the candidate assessment/snapshot reference and advance its checkpoint, then commit. A failure rolls back both snapshot and candidate result. Task6 injects crashes only after this transaction when testing completed-company recovery. No separate public repository method may attach an already independently committed snapshot. Repeated completion for the same run/candidate returns its existing sealed assessment after verifying its decision hash.

Provider invocation errors are wrapped in a dedicated `ProviderDispatchError` inside the dispatch function. Only that tagged error authorizes router fallback; reservation, persistence, cancellation and hook errors propagate unchanged. Provider responses and validated role outputs are different checkpoints: persist the raw bounded response first, validate it, then persist the normalized role result before stage advancement. On resume, validate an existing response before considering another call. A malformed response consumes its attempt. Fallback and repair share the persisted operation attempt numbers1–2; pass only the remaining allowance to the router, never reset it on repair. The router-local index is translated to the persisted operation attempt number.

Authorized views clear `sources` together with a redacted assessment. Apply the same source visibility policy to coverage gap details and event summaries, preserving numeric counts, event sequence and kind with neutral “Evidence unavailable” text. SourceView is built from the authorized snapshot citations and supplies export links; no browser cache is an authority for access.
