# Discovery campaigns: investment question to defensible shortlist

Status: proposed design for user review; implementation is not authorized by this document alone.
Baseline: `origin/main` at `c12529e` (includes living theses, PR #107).
Companion: `../plans/2026-09-10-discovery-campaigns.md` (written after design approval).

## 1. Outcome and confirmed decisions

Help the user discover companies worth researching in response to a theme or catalyst, understand the evidence and counterarguments, and learn how an AI research workflow operates.

The user confirmed on 2026-09-10:

- Theme/catalyst-to-beneficiary questions are the first use case.
- Cover US-listed companies first.
- Combine existing app data with bounded web discovery of new companies.
- Approve the research brief once, then run without intermediate approvals.
- Produce research priorities with valuation context, not a list of buy recommendations.
- Discover up to **100** companies, investigate up to **25**, shortlist up to **10**.

Example input: “Which overlooked US-listed companies benefit from AI data-centre power demand over the next two years?” This is a test question, not a claim about any particular security.

Success means the user can explain why each selected company is relevant, inspect the supporting sources, identify the strongest counterargument, understand the search's limits, and choose a concrete next research action. Ten is a ceiling, never a quota.

## 2. Product flow

1. **New campaign:** enter a question (20–4,000 trimmed characters) and optional seed companies. Save the question before requesting model assistance.
2. **Review research brief:** the planner proposes 2–4 distinct benefit mechanisms, research horizon, must-have criteria, preferences, exclusions, search queries, seed identities, and the fixed research limits. Example mechanism: increased electricity demand → grid equipment orders → suppliers' relevant business lines. Every arrow starts as a hypothesis until supported by evidence.
3. **Approve and start:** approval freezes that brief version and starts one run. Editing the brief creates a new version and does not alter a running or historical run. Show configured search/model readiness before starting.
4. **Observe:** display stage, completed counts, remaining resource limits, and concise activity events. Closing the browser does not stop the worker. The user can request cancellation.
5. **Review results:** show the shortlist, all investigated companies, rejected leads, unresolved identities, and companies not researched because of limits. Show how much of the search was completed and when each piece of evidence was obtained.
6. **Act:** open a company in Analyze, copy a cited research summary, or open a prefilled thesis-monitor draft. Persisting a new monitoring agent remains an explicit user action through the existing flow.
7. **Rerun:** start a new run from the same approved brief, or edit and approve a new version. Keep previous results immutable. Compare shortlist entries/exits and assessment changes only between runs of the same brief; label results from different briefs as different research questions.

Default horizon is 24 months, editable to 1–60 months in the brief. Seeds are optional and never guaranteed a shortlist position. “Overlooked” is a search preference, not a factual label unless supported by an explicit measurable proxy. No implicit small-cap, minimum-price, liquidity, or valuation filter. US scope means an active US exchange listing of a common share or ADR, not US domicile; exclude OTC securities, funds, ETFs, preferred shares, warrants, and private companies in v1. Deduplicate research at issuer level while retaining the selected listing for quote/currency context.

## 3. Output and ranking contract

A shortlisted company must have:

- A resolved issuer and eligible active listing, with identity provenance.
- A specific business line or product exposure and a sourced explanation connecting it to a benefit mechanism.
- At least one accessible primary source directly supporting that company exposure. A search snippet, the model's memory, or a theme keyword match is insufficient.
- A completed counterevidence search and independent skeptic assessment. “No counterevidence found in the bounded search” is allowed; “there are no risks” is not.
- Criteria assessments, source dates, unresolved questions, and a next research action.

Present four separate dimensions: **theme exposure**, **evidence strength**, **business quality**, and **valuation context**. Each uses `strong | mixed | weak | unknown`, a brief explanation, and fact/claim citations. Missing financial data is `unknown`, never zero or a failed numerical criterion. A confirmed must-have failure excludes the candidate; an unknown must-have puts it in `needs_evidence`, not the shortlist.

Use a deterministic research-priority ordering, not a model-generated stock score: eligible candidates first by exposure (strong before mixed), then evidence strength, then business quality; unknown quality follows assessed quality. Break ties by canonical issuer UUID. Valuation is a separately displayed risk/context dimension and does not silently become a buy/sell signal. Weak/unknown exposure cannot qualify. Evidence strength is `strong` only with direct primary exposure evidence and an additional distinct substantive document supporting or challenging the case; primary-only support is `mixed`. Syndicated duplicates are one evidence family, not independent corroboration. Expose the ordering rule in the UI and version it.

A result card contains company/listing, benefit mechanism, exposure summary, the four dimensions, strongest counterargument, unresolved questions, next action, and citations. Do not show invented return forecasts, price targets, analyst counts, or “probability of success.” Show valuation facts only with their actual unit, currency, period, and date. Do not combine incompatible periods or convert currencies silently. Existing supported valuation metrics may be shown; unavailable metrics remain absent with a coverage explanation.

## 4. Search breadth and fair candidate selection

The scout uses three inputs: approved seeds, existing issuer-linked theme/evidence matches, and external search leads. Existing screener results are useful enrichment but must not define the entire discoverable universe: `services/screener/src/db-candidates.ts` currently depends on cached quotes and complete metadata.

Reserve at most 20 search attempts for discovery, at most two initial research searches per selected company, and the remaining ten for retries or focused verification. Allocate initial searches across every approved mechanism, including suppliers, adjacent bottlenecks and alternative beneficiaries where relevant. Do not let one popular mechanism consume the whole run. Resolve externally discovered identities through the existing resolver before treating them as companies. Keep unresolved names/URLs as leads with an explicit reason; never fabricate UUIDs or exchange listings from model text.

Persist at most 100 unique candidate records, including unresolved leads. Deduplicate resolved records by issuer and unresolved records by normalized name plus domain. Stop admitting records when full and record overflow counts. Existing/seeds/web inputs retain distinct origin tags. Each search result list is truncated to ten items before model extraction; persist the query and the truncation count.

Select up to 25 resolved candidates for research deterministically: eligible approved seeds first (maximum five), then round-robin across mechanisms using primary-domain leads before other leads, then first discovery query/result order, with issuer UUID as tie-breaker. Fill remaining slots from the same ordered pool. A company spanning mechanisms consumes one slot. Persist selection order and selection reasons before company research starts. A failed/unknown candidate does not trigger unbounded replacement searches: research the selected cohort and report the gap. Do not present preliminary selection as a quality-verified shortlist.

## 5. Bounded agent workflow and learning

Use named roles with explicit inputs and structured outputs:

- **Planner:** converts the question into an editable research brief.
- **Scout:** proposes leads from actual search results and existing evidence.
- **Analyst:** assesses one company against the approved criteria using supplied evidence.
- **Skeptic:** independently receives the brief and company evidence, not the Analyst's conclusion; checks alternative explanations, weak links, contrary facts, and missing evidence.
- **Selector:** deterministic eligibility and ordering; an optional final model call may summarize already validated results but cannot add companies, facts, ranks, or citations.

These are bounded stages using the configured model router, not an unconstrained network of agents. Deterministic identity, numerical checks, budgets, source validation, and ranking remain ordinary code. A skeptical role provides another structured pass, not proof of independent human judgment.

Activity events describe observable actions and decision summaries: query executed; lead resolved; primary exposure evidence found; company excluded with criterion; skeptic flagged weak evidence; search budget exhausted; shortlist finalized. Every event has run/stage, sequence, timestamp, optional candidate and citations. Optional “How this works” panels explain planning, tool use, retrieval, structured outputs, verification, budget gates, and checkpoints using the actual event. Do not expose or fabricate hidden model reasoning. Prompts, deployment identity, policy versions and validated outputs are retained for engineering inspection; secrets and raw document bodies are not exposed in product activity.

## 6. Limits and completion semantics

Proposed fixed v1 limits per run:

| Resource | Hard limit |
|---|---:|
| Unique candidates / researched / shortlisted | 100 / 25 / 10 |
| External search attempts | 80 |
| Document fetch attempts | 150; at most six documents per company |
| Identity lookup attempts | 120 |
| Financial-provider attempts | 50 |
| Model provider attempts | 64 |
| Model request input / output | 32,000 characters / 2,000 output tokens |
| Individual external request | 30 seconds |
| Whole run | 45 minutes from start; includes downtime |
| Concurrent active runs | One per user |
| Concurrent company evaluations | One in v1 |

A model attempt means each actual provider invocation, including router fallback and retry—not just one call to the router. Add an optional per-attempt hook to the existing router so a campaign can reserve/check budget without changing other callers. Limit scout model extraction to four bounded batches; an unread overflow is reported, not silently included in coverage. Preserve slots for the Analyst and Skeptic of each admitted research candidate; leave final prose optional. Each operation uses a persisted unique attempt key, reserves a budget unit atomically before dispatch, and records success/error/unknown afterward. A timed-out or interrupted attempt still consumes budget. At most one retry per failed logical operation, within the same caps; malformed model outputs get at most one repair attempt, also budgeted.

Brief drafting is a separate bounded operation: at most two provider attempts per request, one draft request in flight per campaign, maximum three draft requests per campaign per rolling hour. The review screen shows these drafting limits too. Drafting failure never deletes the saved question or edited brief.

UI budgets are counts and elapsed time. Monetary estimates must be labeled estimates; show “Cost unavailable” when actual usage/pricing is unavailable. V1 does not promise a hard dollar cap: the current model result contract has no usage accounting. Adding guaranteed currency-denominated budgets is a separate extension. The user does not automatically approve extra calls or a larger search when a limit is reached.

Run statuses: `queued | running | completed | partial | failed | cancelled`. A completed bounded search may legitimately have zero qualifying companies. `partial` means budget/deadline exhaustion or provider failures left planned work incomplete; include reason codes and completed work. `failed` means no usable assessment output could be produced because of a systemic error. Cancellation preserves completed work and prevents new calls; a call already in flight may finish, but stale workers cannot finalize or overwrite state.

## 7. Architecture and canonical boundaries

Add a focused `services/discovery/` package, registered behind the existing dev API. Do not expand `SubjectKind`: a campaign is a user-owned workflow object, and candidates use existing canonical issuer/listing references.

Reuse:

- `services/resolver/` for provider-backed identities and existing issuer/listing resolution.
- `services/screener/` for supported numerical constraints/enrichment; no arbitrary query DSL.
- `services/evidence/` for sources, documents, claim extraction, ownership, document ingestion, and current visibility rules.
- `services/fundamentals/` for normalized, sourced financial facts.
- `services/snapshot/` for immutable evidence manifests and verification.
- `services/llm/` for configured deployments, with the additive per-attempt budget hook.
- `services/observability/` for tool logs and result hashes.
- Existing Analyze and thesis handoffs for follow-up research.

Use a campaign-specific durable worker with a database lease and persisted checkpoints. Do not stretch the monitoring agent's watermark loop into campaign ownership, and do not copy the grid's detached in-process worker: browser/server restarts must not abandon paid research silently. No new general-purpose agent framework, message broker, vector database, or orchestration dependency is required.

Preferred first web-search adapter: Brave Web Search, behind a small provider interface, using native fetch. It returns leads only; fetched primary documents become evidence through the existing evidence service. No search SDK required. `DISCOVERY_SEARCH_API_KEY` and existing model/reference-provider configuration are deployment prerequisites. Missing configuration is a visible preflight failure, never an empty successful shortlist. The adapter choice is an engineering default and can be changed before implementation without altering domain contracts.

## 8. Persistence and versioning

Create six campaign-owned tables, with user ownership derivable through foreign keys and enforced on every query:

1. `discovery_campaigns`: id, user_id, name, question, current_brief_version, archived_at, created_at, updated_at.
2. `discovery_briefs`: id, campaign_id, version, normalized brief JSON, content hash, approved_at, created_at; unique campaign/version. An approved row is immutable. Editing creates a new row; approval targets an exact version/hash.
3. `discovery_runs`: id, campaign_id, brief_id, status, stage, request_key, policy_version, model configuration snapshot, limits/usage JSON, checkpoint JSON, lease_owner/lease_epoch/lease_expires_at, cancel_requested_at, started_at/finished_at, coverage/result summary. Store user_id and enforce a composite foreign key (campaign_id,user_id) to the owning campaign. Unique campaign/request_key plus a partial unique user_id index for queued/running runs enforce idempotency and one active run per user.
4. `discovery_candidates`: id, run_id, issuer_id/listing_id nullable for unresolved leads, lead key, origins, mechanisms, selection ordinal, state, reason codes, Analyst/Skeptic structured assessments, final dimensions, rank nullable, snapshot_id nullable, captured identity display, timestamps. Unique run/issuer for resolved candidates; unique run/lead_key for unresolved leads.
5. `discovery_attempts`: id, run_id nullable for draft attempts, campaign_id, unique operation/attempt key, resource kind, reserved/completed timestamps, outcome, tool_call_id, response reference/hash. Supports bounded draft usage and conservative crash accounting.
6. `discovery_events`: run_id, monotonic sequence, stage, event kind, candidate_id nullable, concise summary, citation refs, learning concept id, created_at; unique run/sequence.

Candidate states: `unresolved_identity | discovered | not_selected | researching | shortlisted | eligible_not_shortlisted | excluded | needs_evidence | research_error`. A pending/researching candidate after interruption remains visibly incomplete until resume/finalization reconciles it. Rank is populated only for shortlisted candidates, unique within the run, 1–10 contiguous. Capture sources/observations as read; a run's start time is not a claim that all later-retrieved evidence existed then. Record `started_at`, each observation/retrieval time, and `finished_at`; no historical backtesting claim.

Checkpoint after discovery selection and after each company's Analyst/Skeptic/verification result. Provider network calls occur outside database transactions. Claim a run with `FOR UPDATE SKIP LOCKED`, lease 90 seconds, heartbeat every 20 seconds, and a monotonically increasing epoch. Every checkpoint/finalization requires matching owner/epoch and a valid lease. Recover expired leases on worker startup. Resume completed operations from stored outputs; ambiguous interrupted external calls consume the reservation and retry at most once. A checkpointed company is not re-researched during the same run.

## 9. Evidence, visibility, and lifecycle

Company exposure must be grounded in an actually fetched SEC or verified issuer source. Ownership of a source and the reporting source of a claim can differ; preserve the document's actual source. Each assessment accepts only supplied fact/claim IDs, verifies field types and bounds, and explicitly distinguishes evidence from inference. Numerical conclusions use deterministic comparisons of normalized facts. Never let source content issue tool instructions or override the approved brief.

Initial company packet: prefer latest available 10-K/20-F for business description, latest 10-Q/6-K where applicable, and relevant recent 8-K/IR disclosures. Search for contrary developments and the filing's risk disclosures. A business-description source older than 24 months cannot alone establish current exposure. Event/catalyst claims older than the brief's configured lookback (default 12 months) are background only. Timestamp unknown means freshness unknown, not current. An inaccessible primary source leaves `needs_evidence`; a search title/snippet cannot replace it.

Fetch new documents only through the evidence boundary: HTTPS, validated public destination addresses at connection time and on redirects, bounded response size (5 MB), maximum three redirects, 30-second timeout, supported HTML/text formats in v1. Reuse existing SEC ingestion for supported filing formats. Unsupported PDFs and blocked/paywalled pages become explicit coverage gaps unless an existing approved ingestion path handles them. Verify company IR domains through identity/SEC-linked issuer metadata; model-provided domains alone are not trusted. No raw content flows through campaign endpoints or activity events.

Seal a candidate snapshot for every usable investigated assessment, including exclusions supported by evidence. Preserve fact/claim/document/source provenance and model/tool hashes. Add discovery-result ownership to the existing evidence-inspection visibility check; never make campaign snapshots public. On read and handoff, enforce current source ownership, deletion and entitlement rules. If evidence is no longer accessible, retain historical metadata with “Evidence no longer available” but withhold affected derived dimensions, explanatory text and citations, and disable promotion until a rerun; do not keep leaking stale cached source-derived text. Campaign deletion removes its attempts/events/results and visibility links, uses existing artifact/snapshot cleanup rules, and does not delete shared sources. Include campaign references in user-erasure cleanup and snapshot reachability queries.

## 10. API surface

All routes require the current authenticated user; missing and foreign-owned resources return 404.

- `POST /v1/discovery/campaigns` `{name, question}` → 201 campaign.
- `GET /v1/discovery/campaigns` → paginated summaries (default 20, maximum 100).
- `GET /v1/discovery/campaigns/:id` → campaign, current brief, latest run summary, readiness.
- `POST /v1/discovery/campaigns/:id/brief/draft` `{expected_version}` → proposed brief; cannot overwrite an edited version.
- `PUT /v1/discovery/campaigns/:id/brief` `{expected_version, brief}` → next saved version, optimistic concurrency.
- `POST /v1/discovery/campaigns/:id/runs` `{brief_version, brief_hash, request_key}` → 202 run; atomically approve the exact current brief and enqueue. A repeated request_key returns the same run; reuse with different content returns 409.
- `GET /v1/discovery/campaigns/:id/runs` → run summaries, newest first, page 20/max100.
- `GET /v1/discovery/runs/:id` → status, progress, coverage, shortlist, limits and usage.
- `GET /v1/discovery/runs/:id/candidates` → cursor-paginated ledger, state filter, max100.
- `GET /v1/discovery/runs/:id/events?after_sequence=N` → bounded event page, next cursor.
- `POST /v1/discovery/runs/:id/cancel` → accepted cancellation or existing terminal state.
- `DELETE /v1/discovery/campaigns/:id` → 204 after cancellation/quiescence and scoped deletion; 409 while a worker still holds a live lease.

400 malformed input, 401 unauthenticated, 404 missing/foreign, 409 stale brief/active-run conflict, 429 draft rate limit, 503 missing required provider/worker readiness. Poll active runs every two seconds while visible, backing off to ten seconds on errors; stop when terminal or page hidden. Preserve editable drafts during background polling, matching the lessons from PR #107.

## 11. UI and handoff

Add a protected `/discovery` entry labeled “Discover” and campaign/run detail routes. The core screens are Question, Research brief, Live research, and Results. Reuse shared loading/error/empty-state patterns and source-inspection components. Keep backend terms such as lease, epoch, JSON, and operation key out of product copy.

Results default to the shortlist. Tabs expose Investigated, Not selected, and Research trail. Show counts by mechanism and origin, incomplete work, and lack of a live quote independently of thematic relevance. The four dimensions are labeled assessments, not progress bars or probabilities. Each result's evidence drawer includes primary support, contrary evidence, and unresolved questions.

“Analyze company” uses the canonical listing route and includes a bounded cited campaign summary. “Monitor this thesis” uses the existing `web/src/analyze/thesisHandoff.ts` pattern and carries a draft thesis, explicit falsifiers and campaign/run/candidate provenance; no automatic agent or thesis save. Unknown valuation never becomes a guessed metric condition. Copy/export contains sources, dates, limitations and “Research shortlist,” not a recommendation label. Watchlist/grid bulk creation, scheduling, notifications and collaboration are outside v1.

## 12. Alternatives and scope boundaries

- **Recommended: dedicated campaign workflow + reused domain services.** Owns discovery, budgets and history while preserving canonical evidence/identity boundaries.
- **Grid extension only:** smaller UI change, but grids begin with a universe and lack campaign briefs, discovery provenance and durable research stages.
- **General autonomous agent framework:** more flexible but adds orchestration, permissions and evaluation surface that v1 does not need.

Exclude scheduled campaigns, automatic trading, portfolio sizing, return predictions, exhaustive market coverage claims, model training, live agent prompt editing, broker integration, PDF export, global coverage and hard dollar guarantees. Manual reruns, cancellation, checkpoint recovery, source visibility and honest partial results are core, not later hardening.

## 13. Acceptance and release gates

1. A theme question creates an editable brief; only the exact approved version runs. Concurrent editing/polling never loses drafts.
2. Newly discovered issuers can enter without cached screener quotes; all final identities resolve canonically and satisfy US listing scope.
3. Candidate, research, shortlist, draft, provider-attempt and deadline limits cannot be exceeded by retries, fallback, concurrent requests or worker restart.
4. Each shortlisted company satisfies primary-source, exposure, must-have, skeptic and visibility gates. Fewer than ten, including zero, is valid.
5. Missing valuation/fundamentals stay unknown; wrong unit/period, stale sources, fabricated citations and duplicated news families cannot improve rank.
6. Scout selection covers each approved mechanism when qualifying leads exist; the UI shows truncated and unresearched portions.
7. Cross-user reads, events, cancellation, snapshots and handoffs are denied. Deletion/erasure removes visibility and cached source-derived text safely.
8. Crash after reservation, after provider response and after candidate commit is tested. Resume never produces duplicate cards/ranks or unmetered repeated calls; stale workers cannot write.
9. Cancellation/deadline/budget/provider failures produce the specified terminal status and preserve completed evidence.
10. Activity events correspond to actual operations. Optional learning copy explains the real implementation, including limits of model critique.
11. Analyze and thesis draft handoffs retain identity and provenance without creating monitoring jobs automatically.
12. Deterministic fixture evaluation covers power infrastructure, industrial automation and a supply-chain disruption, plus an intentionally unsupported theme. Each fixture includes expected admissible/excluded cases, missing data, a misleading famous company and a less-known valid company. No live-ticker “expected winner” assertions.
13. Release requires 100% citation-ID and identity validity, 100% budget/ownership checks, and zero unsupported numerical claims in the fixture suite. A human reviews at least ten candidate assessments across fixtures for actual source support and useful counterarguments; at least nine must be acceptable, with zero fabricated exposure claims. This is a release evaluation, not a promised investment hit rate.
14. Run relevant database, discovery, resolver, evidence, snapshot, model-router and web tests; web typecheck/build/lint; required CI. Track pre-existing unrelated failures separately and introduce no new ones.

## 14. Engineering constraints and sources

- Node.js >=22.19.0; TypeScript with explicit `.ts` imports; PostgreSQL; existing React/Vite UI.
- No new agent framework, message broker, vector database, search SDK, or browser automation dependency.
- Keep domain types browser-safe and canonical; do not duplicate DTOs in the web app.
- New modules should stay focused, normally below 400 lines; do not grow existing giant API/runtime files with inline campaign logic.
- Use `bd` issue tracking, isolated `feat/` branches, focused commits, review and the repository's push workflow. The installed bd version lacks `sync`; export only owned issue changes using the supported CLI.
- Planning is documentation-only. No provider calls using user credentials, new subscriptions, production runs or implementation changes are authorized by approval of this spec alone.

Provider reference checked 2026-09-10: [Brave Web Search API](https://api-dashboard.search.brave.com/api-reference/web/search/get). The adapter uses its documented search endpoint and returns title/URL/description leads; source acquisition and claim verification remain app responsibilities. Alternative considered: [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search), which also provides structured search results. No provider pricing is hard-coded into this design.
