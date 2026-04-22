## Standalone end-to-end plan for a finance research app with generative UI chat

This is the consolidated architecture spec. It incorporates the earlier finance-agent plan, the document-handling refinements, and the accepted product-layer changes needed to match the functionality shown in the videos: ticker and theme chats, a Home feed that is really a cross-agent findings surface, an Analyze tab with editable instructions and selectable data sources, right-rail activity, and interactive charts inside historical chat messages. The videos also strongly suggest that chat is not plain markdown but a typed block renderer shared across chat and analysis surfaces. 

This version is sufficient to build an app with materially similar behavior to the MP4 app, provided the system is built around three ideas:

1. **A deterministic evidence/data plane**
2. **A tool-using analyst that outputs strict UI blocks**
3. **A shared artifact system used by chat, Analyze, agents, Home, and activity surfaces**

OpenAI’s current docs explicitly distinguish **function/tool calling** for connecting the model to system functionality from **structured outputs** for constraining the assistant’s actual reply shape. Anthropic’s tool-use docs describe the same basic loop: the model emits structured tool calls, your application executes them, and the model continues with the results. That distinction is the core design rule here: tools fetch data or perform actions; the assistant’s reply is a schema-constrained `Block[]`.

---

## 1. Product target

The target product is a **desktop-first finance research terminal** with these primary surfaces:

* **Home**
* **Agents**
* **Chat**
* **Screener**
* **Symbol detail**

  * Overview
  * Financials
  * Earnings
  * Holders
  * Reddit
  * Analyze

The target experience includes:

* ticker chats and theme/macro chats in the same right-rail thread list
* interactive chart blocks inside old assistant messages
* a structured Analyze memo with editable instructions and source-selection controls
* “Add results to chat”
* a right-rail activity stream showing agent work like `Reading`, `Investigating`, and `Found`
* a Home surface that is findings-first, not just a raw news page
* light and dark mode
* desktop/Electron feel, with mobile/Expo possible later
* cross-ticker continuity inside the same thread when the user pivots mid-conversation. 

The architecture should support similar functionality without requiring the model to emit HTML, JSX, or raw React components.

---

## 2. Non-negotiable invariants

These are the system’s governing rules.

### I1. No displayed number without a backing row

Every displayed number must trace to a `Fact` or `Computation` with provenance, timestamps, and method. The model never invents a number.

### I2. Narrative and visuals cannot disagree

Prose references facts and claims by ID; values are resolved at render time from the same snapshot used by charts and tables.

### I3. Documents are evidence, not truth

Articles, transcripts, tweets, Reddit threads, and uploads are ingested as `Document` objects first. They may produce claims, events, and candidate facts. They do not become canonical facts merely by being ingested.

### I4. The analyst never sees raw untrusted text

Raw external content is processed by a reader/extractor path. The main analyst consumes only structured outputs.

### I5. Every answer is pinned to a moment

A response is bound to an immutable snapshot. Interactivity inside the response is allowed only within the snapshot contract.

### I6. Multi-entity reasoning happens through roles and impacts

A document can mention many subjects, but the reasoning unit is the claim plus its arguments and entity-impact edges.

### I7. Side effects require approval

Alerts, exports, emails, private-tool reads, and any future transactional tools require explicit user confirmation.

### I8. Refresh is explicit

Interactivity inside a sealed snapshot is allowed only for approved transforms. Anything requiring fresher data or a changed subject set triggers refresh.

These rules are also aligned with current agent-safety guidance that recommends structured outputs between workflow nodes and approvals around sensitive tool access, especially when untrusted text could otherwise steer downstream tools.

---

## 3. System overview

The app should be built as **three systems on one data plane**:

1. **Deterministic terminal surfaces**

   * watchlists
   * quotes
   * charts
   * stock detail tabs
   * screener
   * portfolio overlay

2. **Interactive research chat**

   * structured `Block[]` responses
   * tool-using analyst
   * citations, provenance, disclosures
   * persistent threads
   * cross-thread artifacts

3. **Background thesis agents**

   * scheduled research
   * claim/event monitoring
   * finding generation
   * notifications
   * Home feed and right-rail activity

The data plane underneath them is shared.

---

## 4. Architecture at a glance

```text
Client (Web / Electron / Mobile)
        |
        v
API / BFF Layer
(auth, thread routes, Home, Agents, Analyze, Screens, SSE bootstrap)
        |
        v
Session Coordinator
(Durable Object per chat thread / long-running analysis / agent run)
        |
        v
Orchestrator
(intent, bundle selection, budgets, approvals, snapshot staging)
        |
        +------------------------+
        |                        |
        v                        v
Deterministic Services      Model Services
(resolver, calculators,     Reader model
normalizer, verifier,       Analyst model
snapshot sealer)            Title/Summary model
        |
        v
Tool Gateway
        |
        +--------------------------------------------------------------+
        |              |               |              |                 |
        v              v               v              v                 v
Identity/Resolver  Market Data   Fundamentals   Evidence Service   Screening/Alerts
                                   Service       (docs/facts/       /Home feed
                                                 claims/events)
        |
        v
Storage Layer
- App metadata DB
- Evidence DB
- Object store
- Search index
- Cache
- Queue
```

For a Cloudflare-centric build, Durable Objects are appropriate for **stateful coordination** because each object is globally addressable, single-threaded, and has strongly consistent colocated storage. D1 is suitable for app metadata and smaller relational workloads but is not the right primary store for a large fact warehouse; current D1 limits are 10 GB per database on paid plans. Cloudflare Queues are useful for async ingestion and agent runs, but they provide at-least-once delivery and do not guarantee messages are consumed in publish order, so agent runs must be idempotent and watermark updates must not assume FIFO behavior.

---

## 5. Product surfaces

### 5.1 Home

Home is **not** a raw news feed. It is a cross-agent findings surface.

It should show:

* finding cards from active agents
* deduped by `ClaimCluster`
* grouped by theme/subject where appropriate
* ranked by recency + severity + relevance
* collapsed to headline + source + subject/theme tag + timestamp

It can also include:

* market pulse
* watchlist movers
* agent summaries
* pinned screens

### 5.2 Agents

The Agents surface lets users:

* create and edit agents
* set thesis, universe, cadence, and alert rules
* inspect run history
* view findings
* view execution activity (`Reading`, `Investigating`, `Found`, `Dismissed`)

### 5.3 Chat

Chat is the flagship surface.

Requirements:

* threads can be about a ticker, a theme, a macro topic, a screen, or a portfolio
* one thread can still discuss multiple subjects
* assistant replies are `Block[]`, not markdown-only text
* blocks remain interactive after generation
* right rail lists chats by human-readable title
* old messages retain their UI state and chart interactivity

### 5.4 Symbol detail

Routes like:

* `/symbol/:ticker/overview`
* `/symbol/:ticker/financials`
* `/symbol/:ticker/earnings`
* `/symbol/:ticker/holders`
* `/symbol/:ticker/reddit`
* `/symbol/:ticker/analyze`

### 5.5 Analyze

Analyze is a saved, template-driven analysis workflow, not just “chat with a symbol loaded.”

It should support:

* editable instructions
* selectable source categories
* optional added peer stocks or benchmarks
* a structured memo layout
* reruns
* “Add results to chat”

### 5.6 Screener

Saved and ad hoc screens. These can also feed watchlists, agents, and universes.

### 5.7 Watchlists and portfolio

Watchlists support manual and dynamic modes. Portfolio is lightweight holdings tracking, not a brokerage integration.

---

## 6. Canonical subject model

The biggest identity correction is to separate security identity from user-facing research subjects.

### 6.1 Finance identity layer

```ts
Issuer {
  issuer_id
  legal_name
  former_names[]
  cik?
  lei?
  domicile
  sector?
  industry?
}

Instrument {
  instrument_id
  issuer_id
  asset_type        // common_stock | adr | etf | index | crypto | fx | bond
  share_class?
  isin?
  figi_composite?
}

Listing {
  listing_id
  instrument_id
  mic
  ticker
  trading_currency
  timezone
  active_from
  active_to
}
```

This is the correct way to avoid ticker-reuse, dual-class confusion, ADR confusion, and cross-listing errors.

### 6.2 Research subject layer

```ts
SubjectRef =
  | { kind: "issuer"; id: string }
  | { kind: "instrument"; id: string }
  | { kind: "listing"; id: string }
  | { kind: "theme"; id: string }
  | { kind: "macro_topic"; id: string }
  | { kind: "portfolio"; id: string }
  | { kind: "screen"; id: string };
```

Then add first-class research subjects:

```ts
Theme {
  theme_id
  name
  description
  membership_mode       // manual | rule_based | inferred
  membership_spec?
  active_from
  active_to?
}

ThemeMembership {
  theme_id
  subject_ref
  score
  rationale_claim_ids[]
  effective_at
  expires_at?
}

Portfolio {
  portfolio_id
  user_id
  name
  base_currency
}

PortfolioHolding {
  portfolio_id
  subject_ref
  quantity
  cost_basis
  opened_at?
}
```

This is how theme chats like “Iran-US Trade Tensions” or “AI Chips Alpha” fit naturally alongside ticker chats. 

---

## 7. Core data model

### 7.1 Metric and fact layer

```ts
Metric {
  metric_id
  display_name
  unit_class
  aggregation
  interpretation
  definition_version
  canonical_source_class
}

Fact {
  fact_id
  subject_ref
  metric_id
  period
  value
  unit
  currency?
  scale
  as_of
  reported_at
  observed_at
  source_id
  method                  // reported | derived | estimated | vendor | extracted
  adjustment_basis?
  definition_version
  verification_status     // authoritative | candidate | corroborated | disputed
  freshness_class         // real_time | delayed_15m | eod | filing_time | stale
  coverage_level          // full | partial | sparse | unavailable
  quality_flags[]
  entitlement_channels[]  // app | export | email | push
  confidence
  supersedes?
  superseded_by?
  invalidated_at?
  ingestion_batch_id
}
```

### 7.2 Claims, events, impacts, computations

```ts
Claim {
  claim_id
  document_id
  predicate
  text_canonical
  polarity
  modality                // asserted | estimated | speculative | rumored | quoted
  reported_by_source_id
  attributed_to_type      // issuer_mgmt | journalist | analyst | tweet_author | anonymous
  attributed_to_id?
  effective_time?
  confidence
  status                  // extracted | corroborated | disputed | rejected
}

ClaimArgument {
  claim_id
  subject_ref
  role                    // subject | object | customer | supplier | competitor | regulator ...
}

EntityImpact {
  claim_id
  subject_ref
  direction               // positive | negative | mixed | unknown
  channel                 // demand | pricing | supply_chain | regulation | competition
  horizon                 // near_term | medium_term | long_term
  confidence
}

Event {
  event_id
  subject_refs[]
  type                    // earnings_release | guidance_update | rating_change | m&a | split ...
  occurred_at
  status                  // reported | confirmed | canceled
  source_claim_ids[]
  source_ids[]
}

Computation {
  computation_id
  formula_id
  code_version
  input_refs[]
  output_ref
  created_at
}
```

### 7.3 Sources and documents

```ts
Source {
  source_id
  provider                // sec_edgar | issuer_ir | reuters | x | reddit | internal
  kind                    // filing | press_release | transcript | article | social_post | upload
  canonical_url?
  trust_tier              // primary | secondary | tertiary | user
  license_class
  retrieved_at
}

Document {
  document_id
  source_id
  provider_doc_id?
  kind                    // filing | transcript | article | research_note | social_post | thread | upload
  parent_document_id?
  conversation_id?
  title?
  author?
  published_at
  lang
  content_hash
  raw_blob_id
  parse_status
  deleted_at?
}

Mention {
  document_id
  subject_ref
  prominence              // headline | lead | body | incidental
  mention_count
  confidence
}

ClaimEvidence {
  claim_id
  document_id
  locator
  excerpt_hash
  confidence
}

ClaimCluster {
  cluster_id
  canonical_signature
  first_seen_at
  last_seen_at
  support_count
  contradiction_count
  aggregate_confidence
}
```

### 7.4 Snapshots, findings, activity, templates

```ts
SnapshotManifest {
  snapshot_id
  created_at
  subject_refs[]
  fact_refs[]
  claim_refs[]
  event_refs[]
  series_specs[]
  source_ids[]
  tool_call_ids[]
  as_of
  basis
  normalization
  coverage_start
  allowed_transforms
  model_version
  parent_snapshot?
}

Finding {
  finding_id
  agent_id
  snapshot_id
  subject_refs[]
  claim_cluster_ids[]
  severity
  headline
  summary_blocks[]
  created_at
}

RunActivity {
  run_activity_id
  agent_id
  stage                  // reading | investigating | found | dismissed
  subject_refs[]
  source_refs[]
  summary
  ts
}

AnalyzeTemplate {
  template_id
  user_id
  name
  prompt_template
  source_categories[]
  added_subject_refs[]
  block_layout_hint?
  peer_policy?
  disclosure_policy?
  version
  created_at
  updated_at
}
```

---

## 8. How documents fit into the architecture

Documents are first-class evidence objects. They do not bypass the evidence layer.

### 8.1 Document lifecycle

```text
Acquire raw document
  -> Canonicalize
  -> Parse
  -> Entity-link
  -> Reader extraction
  -> Claims / impacts / candidate facts / events
  -> Cluster / corroborate / promote
  -> Snapshot / blocks / findings / alerts
```

### 8.2 Ingestion sources

The system should support at least:

* SEC filings
* issuer press releases
* earnings transcripts
* news articles
* research notes
* X / tweets
* Reddit posts/threads
* uploaded PDFs and notes
* internal user memos

### 8.3 Promotion rules

| Document kind                      | Typical outputs                                     | Authoritative fact creation       |
| ---------------------------------- | --------------------------------------------------- | --------------------------------- |
| Filing / primary issuer disclosure | facts, claims, events                               | Yes                               |
| Press release / earnings release   | facts, claims, events                               | Yes, under parser rules           |
| Transcript                         | claims, events, candidate facts                     | Sometimes, with attribution       |
| News article / research note       | claims, events, candidate facts, impacts            | Usually no                        |
| Tweet / X / Reddit                 | claims, sentiment, impact leads                     | No                                |
| User upload / memo                 | user-scoped claims, notes, optional candidate facts | User-scoped only unless validated |

### 8.4 Reader/analyst boundary

The reader handles:

* raw HTML
* raw PDFs
* raw tweets
* raw transcript turns

The analyst sees only:

* claims
* events
* candidate facts
* authoritative facts
* evidence bundles
* entity impacts
* claim clusters

That boundary is the right way to contain prompt-injection risk from external text. OpenAI’s current safety guidance recommends passing untrusted content through structured outputs between nodes rather than letting free-form text propagate into downstream, tool-using stages.

### 8.5 Multi-entity documents

A single article can produce several claims, each with different subject roles and impacts. The document is single; the reasoning fan-out is claim-based.

That is the key rule for finance research:

> **Documents are evidence. Claims are the unit of reasoning. Facts are the unit of truth. Impacts are the unit of routing.**

---

## 9. Data platform and services

The data plane should be split into services by responsibility, but claims/facts/events should be unified behind one evidence boundary.

### 9.1 Identity and resolver service

Responsibilities:

* issuer/instrument/listing resolution
* theme and macro-topic resolution
* alias handling
* fuzzy search
* subject disambiguation
* peer seeds and universe references

### 9.2 Market data service

Responsibilities:

* latest quote
* delayed/real-time state
* intraday and historical bars
* corporate actions
* aligned performance series
* normalized comparison series

Contracts must include:

* `as_of`
* `delay_class`
* `adjustment_basis`
* `currency`
* `source_id`

### 9.3 Fundamentals service

Responsibilities:

* company profile
* normalized statements
* key ratios and stats
* holders / insiders
* estimates / consensus if licensed
* fiscal calendar normalization

For US issuers, the SEC’s EDGAR data APIs are the primary-source anchor. The SEC documents that `data.sec.gov` provides unauthenticated JSON APIs, including submissions history and XBRL company facts, updated throughout the day in real time. The SEC also notes an important limitation: the company-facts aggregates are for non-custom taxonomy facts that apply to the filing entity as a whole. That is exactly why segment data, issuer-specific extension facts, and much non-GAAP logic need a separate filing extraction pipeline rather than a naïve companyfacts-only implementation.

### 9.4 Evidence service

This is the unified backbone. It should own:

* sources
* documents
* mentions
* claims
* claim arguments
* impacts
* events
* facts
* computations
* claim clusters
* evidence bundles
* snapshots
* provenance and lineage

This service replaces the idea of a completely separate “fact store service” and “claim/event graph service.” Internally, it can still use separate tables. Externally, it should expose one coherent evidence API.

### 9.5 Filing extraction platform

This sits adjacent to Evidence and feeds it.

Responsibilities:

* filing retrieval
* section segmentation
* XBRL extension parsing
* segment extraction
* footnote extraction
* management claims extraction
* event detection
* review queue for low-confidence extractions

### 9.6 Research corpus and search

Responsibilities:

* raw corpus storage
* BM25 retrieval
* vector retrieval
* evidence bundle assembly
* document/thread graph traversal

### 9.7 Screening service

Responsibilities:

* saved screens
* filter execution
* ranking
* dynamic universe generation

### 9.8 Home feed service

Responsibilities:

* query findings across active agents
* dedupe by `ClaimCluster`
* rank by recency + severity + relevance
* produce collapsed cards and expanded detail views

### 9.9 Notification service

Responsibilities:

* web push
* email digests
* SMS alerts
* mobile push

---

## 10. Storage layout

| Data                                                | Recommended store                  |
| --------------------------------------------------- | ---------------------------------- |
| Users, chats, watchlists, agents, alerts, templates | D1 or Postgres                     |
| Facts, claims, events, computations, snapshots      | Postgres partitioned by time/class |
| Historical series / big time series blobs           | Parquet/object store + hot cache   |
| Raw documents and parsed artifacts                  | R2/S3                              |
| Symbol/typeahead index                              | Typesense / Meilisearch            |
| Corpus retrieval index                              | BM25 + vector store                |
| Live session coordination                           | Durable Objects                    |
| Async ingestion / agent jobs                        | Queues                             |
| Hot quote/session cache                             | Redis/KV                           |

This split preserves Cloudflare where it is strongest—edge coordination and app plumbing—without forcing D1 to become the whole research warehouse. Durable Objects are a strong fit for serialized per-thread coordination; D1 has database-size limits that make it a poor sole backend for a growing finance evidence store; and Queues are appropriate for async jobs but must be handled with idempotency because delivery is at-least-once and ordering is not guaranteed.

---

## 11. Tool architecture

### 11.1 Tool design rules

Tools must be:

* provider-agnostic
* typed with JSON schema
* read-only by default
* cost-bounded
* provenance-aware
* deterministic in output shape

The model should never know whether `get_series` is backed by a cache, a vendor, or a warehouse.

### 11.2 Reader-only tools

```ts
search_raw_documents(query, subjects?, range?, source_policy?)
fetch_raw_document(document_id)
extract_mentions(document_id)
extract_claims(document_id, schema)
extract_candidate_facts(document_id, schema)
extract_events(document_id, schema)
classify_sentiment(document_id)
build_evidence_bundle(claim_ids[] | event_ids[])
```

### 11.3 Analyst-facing tools

```ts
resolve_subjects(text)
resolve_period(text, subject_ref?)

get_quote(subject_ref)
get_series(subject_ref, range, interval, basis)
get_performance_series(subject_refs[], range, basis, normalize)

get_company_profile(subject_ref)
get_statement_facts(subject_ref, statement, periods, basis)
get_key_stats(subject_ref)
get_segment_facts(subject_ref, periods, axis)
get_holders(subject_ref, kind)
get_analyst_consensus(subject_ref)
get_eps_surprise(subject_ref, n_quarters)

get_claims(subject_refs[], predicates?, range?, trust_min?)
get_claim_clusters(subject_refs[], range?, trust_min?)
get_events(subject_refs[], types?, range?)
get_entity_impacts(subject_refs[], range?)
get_evidence_bundle(claim_ids[] | event_ids[])
get_fact_lineage(fact_id)
get_coverage_report(subject_ref)

get_peer_set(subject_ref, criteria, n)
screen(filters, universe?, sort, limit)
```

### 11.4 Side-effecting tools

```ts
create_alert(subject_ref, rule, channels[])
add_to_watchlist(watchlist_id, subject_ref)
create_agent(thesis, universe, cadence, prompt_template)
send_digest(...)
```

These do not execute immediately. They return pending actions that require explicit approval blocks.

### 11.5 Bundles

Bundles should constrain the model’s choice space:

* `quote_lookup`
* `single_subject_analysis`
* `peer_comparison`
* `theme_research`
* `segment_deep_dive`
* `document_research`
* `filing_research`
* `screener`
* `alert_management`
* `agent_management`
* `analyze_template_run`

The system selects the bundle. The model chooses tools within the bundle.

This is consistent with current tool-calling design guidance: tools are application-defined operations, the model emits structured calls, the application executes them, and the final user-facing response can be separately schema-constrained.

---

## 12. Model topology

The system should use four execution roles.

### 12.1 Deterministic resolver/router

Handles:

* symbol/name extraction
* theme detection
* subject disambiguation
* period resolution
* simple fast paths
* auth/rate limits
* bundle selection

### 12.2 Reader model

Small and cheap.

Input:

* raw document
* schema
* optional subject hints

Output:

* mentions
* claims
* claim arguments
* impacts
* candidate facts
* events
* evidence locators

No downstream action rights.

### 12.3 Analyst model

Bigger tool-using model.

Input:

* user request
* thread summary
* resolved subjects and period
* tool outputs
* structured claims/events/facts
* response schema

No raw article bodies, raw tweets, raw transcripts, or raw filing pages.

### 12.4 Deterministic verifier

Checks:

* schema validity
* reference bindings
* source refs
* units and periods
* disclosures
* approval rules
* snapshot transform compatibility

### 12.5 Summary/title model

Async model pass for:

* thread titles
* thread summaries
* finding summaries
* Home card headlines

---

## 13. Prompt construction and caching

Prompt construction should be designed for cache stability from the start. Anthropic’s prompt-caching docs describe the cache hierarchy as `tools -> system -> messages`, which means tool definitions and stable system policy should stay in the prefix, while volatile user-turn state should stay later.

Recommended prompt order:

1. tool registry
2. global rules and safety policy
3. bundle policy
4. response schema
5. few-shot examples
6. thread summary
7. resolved subjects and period
8. current user request

This is a design rule, not an afterthought.

---

## 14. Turn loop

### Phase 1: Pre-resolve

* extract subject candidates
* resolve period
* load thread summary and prior snapshot
* detect trivial fast path
* enforce auth/rate limits

### Phase 2: Bundle selection

* determine intent
* select bundle
* set budgets
* determine required disclosure tiers

### Phase 3: Analyst tool loop

* analyst sees only bundle tools
* emits tool calls
* orchestrator validates args
* tools execute in parallel where safe
* outputs normalized
* loop continues until final `Block[]`

### Phase 4: Stage manifest

Build a provisional manifest containing:

* fact refs
* claim refs
* event refs
* series refs
* source refs
* disclosure refs
* tool call refs

### Phase 5: Verifier

Check:

* all refs exist
* all cited sources are present
* all numeric refs match format/period/unit
* all blocks bind to canonical data
* all required disclosures are present
* side effects are approval-gated

### Phase 6: Seal snapshot

On success:

* create immutable `snapshot_id`
* persist sealed manifest
* bind message to snapshot

### Phase 7: Stream

Recommended SSE events:

* `turn.started`
* `tool.started`
* `tool.completed`
* `snapshot.staged`
* `snapshot.sealed`
* `block.began`
* `block.delta`
* `block.completed`
* `turn.completed`
* `turn.error`

### Phase 8: Persist + summarize

Persist:

* message
* blocks
* snapshot
* tool logs
* citation links
* thread summary updates

---

## 15. Snapshot contract

This is one of the most important details because it governs in-message interactivity.

A snapshot should pin:

```ts
SnapshotManifest {
  snapshot_id
  subject_refs[]
  as_of
  basis
  normalization
  coverage_start
  source_ids[]
  fact_refs[]
  claim_refs[]
  event_refs[]
  allowed_transforms: {
    ranges: ["1D","1W","1M","3M","6M","YTD","1Y","5Y","All"],
    intervals: ["1m","5m","1D","1W","1M"],
    sort_fields: [...],
    range_end_max: "as_of"
  }
}
```

### In-snapshot transform

Allowed if:

* same subject set
* same basis
* same normalization
* range end is `<= as_of`
* requested transform is listed in `allowed_transforms`

### Out-of-snapshot transform

Requires refresh if:

* fresher data is needed
* peer set changes
* basis changes
* normalization changes
* source policy changes
* new claims/facts are required

This is how the app can support a historical performance block whose timeframe buttons work instantly inside an old chat message, while still preserving the “answer pinned to a moment” invariant. The snapshot pins the subject set and `as_of`, not a single immutable displayed range. 

---

## 16. Frontend architecture

### 16.1 Stack

A practical implementation stack:

* React + TypeScript
* route-driven app shell
* TanStack Query for server state
* Zustand for local UI state
* Motion for animation
* TradingView Lightweight Charts for price/performance
* Recharts or Visx for smaller analytical blocks
* Electron shell for desktop
* Expo for later mobile client

### 16.2 Route model

```text
/home
/agents
/chat/:threadId
/screener
/symbol/:ticker/overview
/symbol/:ticker/financials
/symbol/:ticker/earnings
/symbol/:ticker/holders
/symbol/:ticker/reddit
/symbol/:ticker/analyze
```

### 16.3 State split

* **local UI state**: composer text, expanded sections, scroll anchoring, selected chart range
* **server state**: quotes, bars, profile, artifacts, findings
* **persistent state**: threads, watchlists, agents, templates, snapshots

### 16.4 Rendering model

The frontend renders strict block types from a registry.

```ts
type Block =
  | RichText
  | Section
  | MetricRow
  | Table
  | LineChart
  | RevenueBars
  | PerfComparison
  | SegmentDonut
  | SegmentTrajectory
  | MetricsComparison
  | AnalystConsensus
  | PriceTargetRange
  | EpsSurprise
  | FilingsList
  | NewsCluster
  | FindingCard
  | SentimentTrend
  | MentionVolume
  | Sources
  | Disclosure
```

### 16.5 Block rules

Every block supports:

* `loading`
* `ready`
* `error`

Every block includes:

```ts
BaseBlock {
  id
  kind
  snapshot_id
  data_ref
  source_refs[]
  as_of
  disclosure_tier?
  interactive?
}
```

Rich text should bind by reference:

```ts
RichText {
  kind: "rich_text"
  segments: [
    { type: "text", text: "Revenue grew " },
    { type: "ref", ref_kind: "fact", ref_id: "f_123", format: "pct" },
    { type: "text", text: " YoY, driven by " },
    { type: "ref", ref_kind: "claim", ref_id: "c_98" }
  ]
}
```

That avoids reverse-parsing prose during verification.

### 16.6 Section container

Add a real section block:

```ts
Section {
  kind: "section"
  title
  children: Block[]
  collapsible?
}
```

This is important for Analyze and memo-style responses.

### 16.7 Chat-specific UX rules

The chat must preserve the characteristics visible in the videos:

* assistant messages are structured and full-width
* user messages are lighter, simpler, right-aligned
* composer is pinned, minimal, and can be send-button-less
* right rail holds thread list and active-thread context
* old blocks remain interactive
* light/dark mode parity exists. 

### 16.8 Streaming and performance

Frontend requirements:

* SSE-driven incremental rendering
* virtualized message list for long threads
* memoized blocks by content hash
* skeleton-first rendering for charts
* scroll “tailing” logic with a jump-to-latest affordance
* chart blocks fetch data through backend using `snapshot_id + transform`, never direct vendor calls

---

## 17. Analyze templates

Analyze must be a first-class workflow system.

### 17.1 Template model

```ts
AnalyzeTemplate {
  template_id
  user_id
  name
  prompt_template
  source_categories[]      // company profile, financials annual, quarterly, news, reddit ...
  added_subject_refs[]     // peers, benchmarks, related names
  block_layout_hint?       // section order / preferred charts
  peer_policy?
  disclosure_policy?
  version
}
```

### 17.2 Design rules

Users should select **source categories and layout**, not raw internal tool names. The orchestrator still maps those selections to safe bundles and tool policies.

### 17.3 Analyze flow

1. user opens symbol Analyze tab
2. chooses or edits template
3. template resolves to tool bundle + block-layout hint
4. analyst runs with symbol + added peers + template scope
5. structured memo is rendered using the same `BlockRegistry`
6. “Add results to chat” copies or references the memo blocks into a chat thread with shared snapshot provenance

This matches the video behavior without creating a second rendering system. 

---

## 18. Agents, findings, Home, and activity

### 18.1 Agent model

```ts
Agent {
  agent_id
  user_id
  thesis
  universe                  // subject list or dynamic screen/theme/portfolio
  source_policy
  cadence
  prompt_template
  alert_rules[]
  watermarks[]
  enabled
}
```

### 18.2 Run loop

1. determine new items since watermark
2. ingest/retrieve new facts, events, documents
3. run reader extraction where needed
4. cluster/corroborate/update impacts
5. score relevance to thesis
6. run analyst on structured evidence
7. emit findings
8. update activity stream
9. evaluate alerts
10. transactionally advance watermarks

### 18.3 Findings vs activity

These should remain distinct.

* **Finding**: durable research output, user-facing
* **RunActivity**: execution/status artifact

This is what lets Home be findings-first while the right rail can still show granular progress like `Reading` or `Investigating`.

### 18.4 Home feed

`HomeFeed` should:

* query findings across all active agents
* dedupe by `ClaimCluster`
* collapse similar findings
* rank by recency + severity + relevance
* render cards with theme/subject tag + time + source

### 18.5 Agent notifications

Trigger on:

* finding severity thresholds
* price changes
* sentiment changes
* new filings
* thesis-specific rules

Channels:

* web push
* email
* SMS
* mobile push

### 18.6 Watchlists and portfolio

Watchlists should support:

```ts
Watchlist {
  watchlist_id
  user_id
  name
  mode                // manual | screen | agent | theme | portfolio
  membership_spec?
}
```

This covers the “Manual / Auto” behavior implied by the videos. Auto watchlists can mirror:

* screen outputs
* theme memberships
* agent universes
* portfolio holdings. 

---

## 19. Security, trust, and disclosure

### 19.1 Untrusted content policy

All external narrative content is untrusted. Only the reader sees it raw.

### 19.2 Structured boundaries

All handoffs between nodes should be structured schemas, not arbitrary prose.

### 19.3 Tool approvals

High-risk reads/writes require confirmation. This applies especially if you later add MCP connectors, email, calendar, portfolio files, or brokerage-related integrations.

### 19.4 Disclosures

Every response may require disclosure blocks such as:

* delayed pricing
* based on data as of date X
* low analyst coverage
* social/Reddit content is tertiary and unverified
* estimates vs reported facts
* candidate vs authoritative data

### 19.5 No implicit conversions

Do not silently:

* FX-convert
* mix fiscal and calendar bases
* mix adjusted and unadjusted performance bases

If conversion is done, it must be block-visible and source-backed.

OpenAI’s agent-safety guidance explicitly recommends structured outputs between nodes, tool approvals, and careful handling of MCP-connected tools and untrusted inputs.

---

## 20. Observability and evaluation

You need these from the start:

* `tool_call_log`
* `snapshot_audit`
* `citation_log`
* `extraction_eval`
* `verifier_fail_log`
* `agent_run_log`
* `drift_report`
* `golden_eval_results`

### Golden set categories

The evaluation suite should cover:

* ticker/name disambiguation
* issuer vs listing confusion
* themes and macro topics
* fiscal/calendar alignment
* corporate actions
* restatements
* segment redefinitions
* low analyst coverage
* delisted/acquired names
* multi-entity documents
* candidate vs authoritative fact promotion
* social rumor handling
* block-choice correctness
* snapshot transform correctness

OpenAI’s current docs emphasize evals and trace-level monitoring for agent quality and improvement loops.

---

## 21. MCP position

MCP should be an **optional interoperability layer**, not the core execution model of the app. OpenAI’s MCP docs describe MCP as an open protocol for extending models with additional tools and knowledge. That makes it useful for external connectors and portability, but your core subject model, evidence plane, approvals, snapshots, and provenance should remain native to your system.

Use MCP later for:

* external documentation and research connectors
* optional integrations with private tools
* developer tooling

Do not let MCP define your canonical internal architecture.

---

## 22. Deliberate non-goals

This plan intentionally avoids:

* live market streaming inside sealed assistant messages
* raw web access by the analyst
* brokerage execution
* implicit trading workflows
* exposing chain-of-thought
* using document mentions as a proxy for entity impact
* treating tweets or Reddit posts as authoritative facts

This is a research system, not a trading platform.

---

## 23. Build sequence

### Phase 0 — foundation

* app shell
* auth
* route structure
* subject resolver
* watchlists
* quotes
* symbol search

### Phase 1 — terminal core

* symbol detail surfaces
* market data service
* fundamentals service
* screener
* portfolio/watchlist basics

### Phase 2 — structured chat

* session coordinator
* orchestrator
* strict `Block[]` schema
* reader/analyst split
* initial blocks
* snapshots
* verifier
* thread summaries/titles

### Phase 3 — document and evidence plane

* document/source models
* object storage
* corpus parsing
* claim/event extraction
* candidate fact promotion logic
* evidence bundles
* claim clustering

### Phase 4 — product parity layers

* themes/macro subjects
* Home feed
* Analyze templates
* section blocks
* Reddit-specific blocks
* dynamic watchlists
* right-rail activity

### Phase 5 — background agents

* agent CRUD
* queue runner
* findings
* activity stream
* notifications
* Home feed ranking/deduping

### Phase 6 — hard cases and scale

* segment extraction refinement
* non-US coverage
* reviewer queues
* export/share policies
* deeper evals and drift monitoring

---

## 24. Bottom line

The architecture should be built around this sentence:

> **A finance research app like the one in the videos is not “a chatbot with charts.” It is an evidence system plus a structured artifact renderer plus a tool-using analyst.**

The final shape is:

* **Identity layer:** issuer / instrument / listing
* **Research subject layer:** theme / macro topic / portfolio / screen
* **Evidence layer:** documents, sources, facts, claims, events, impacts, computations, snapshots
* **Orchestration layer:** resolver, reader, analyst, verifier
* **Artifact layer:** strict `Block[]`
* **Product surfaces:** Home, Agents, Chat, Analyze, Screener, Symbol detail
* **Async layer:** findings, activity, notifications

That is the end-to-end plan I would implement. The next concrete artifact should be the full schema pack plus the API contracts for the evidence service, snapshot service, block schema, and analyst tool registry.
