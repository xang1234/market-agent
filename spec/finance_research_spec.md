# Finance Research App — schema pack and implementation contract

This document is the concrete implementation companion to the architecture plan. It defines the canonical domain model, service boundaries, API contracts, block model, tool registry conventions, and the end-to-end workflows needed to build a finance research product with the same functional shape as the reference videos: typed chat blocks, theme and ticker chats, Analyze templates, cross-agent Home feed, right-rail activity, and in-message interactive charts.

## 1. Scope

The system is a desktop-first research terminal with five primary top-level workspaces and one entered subject-detail surface family:

- Primary top-level workspaces: Home, Agents, Chat, Screener, Analyze
- Entered subject-detail surfaces: Symbol detail

The app is built around three subsystems on one evidence plane:

1. Deterministic terminal surfaces
2. Interactive research chat
3. Background agents and findings

## 2. Operating invariants

### 2.1 Truth and provenance
- No displayed number exists without a backing `Fact` or `Computation` row.
- A displayed value always carries provenance, timestamps, method, and disclosure tier.
- Facts are immutable except through supersession.
- Candidate facts from narrative sources do not become authoritative without explicit promotion rules.

### 2.2 Structured reasoning boundary
- Documents are evidence, not truth.
- The reader path may ingest raw untrusted text.
- The analyst path never sees raw untrusted text.
- All inter-stage handoffs are structured schemas.

### 2.3 Snapshot and interactivity
- Every assistant response is pinned to a sealed `SnapshotManifest`.
- In-message interactions are allowed only when they are listed in `allowed_transforms` and do not require fresher data than `as_of`.
- Changing the timeframe of a historical comparison chart is allowed if the range end remains less than or equal to `as_of` and the subject set, basis, and normalization stay constant.
- Any request for fresher data, different peers, different basis, or different normalization requires refresh.

### 2.4 User actions and approvals
- Alerts, digests, external exports, and any future transactional action require explicit approval.
- Low-risk actions such as adding an item to a watchlist may be auto-approved if policy allows.

## 3. Product surfaces and ownership

### 3.1 Home
Home is a findings-first surface. It is the union of recent `Finding` objects across active agents, deduped by `ClaimCluster`, ranked by recency, severity, and user relevance.

### 3.2 Agents
Agents are scheduled research processes over a universe of `SubjectRef`s. They produce `Finding` objects and `RunActivity` rows.

### 3.3 Chat
Chat is the flagship research interface. Assistant messages are strict `Block[]` artifacts, not plain markdown transcripts.

### 3.4 Symbol detail
Symbol detail is an entered subject workspace with sections such as Overview, Financials, Earnings, Holders, and Signals. It may launch into top-level `Analyze` with carried subject context.

### 3.4.1 Overview, financials, and earnings tab composition

- `overview` owns the deterministic single-subject summary that extends the thin quote landing state into a durable core tab.
- `overview` composes listing-aware quote context, company profile context, key stats, and a limited performance or context summary, but it does not become a second home for full statement tables, holders, or interpretive evidence flows.
- `financials` owns normalized statement tables, statement-linked trend views, and segment-aware financial breakdowns for the selected subject.
- `financials` composes normalized statement outputs plus the aggregation layer for key stats and segment facts rather than rebuilding fundamentals logic from provider-specific payloads.
- `earnings` owns deterministic earnings chronology, expectation-versus-result views, and consensus summaries for the selected subject.
- `earnings` composes earnings-release events, EPS surprise history, analyst consensus, and price-target context without turning transcript reading, news clustering, or freeform commentary into tab-owned responsibilities.

### 3.4.2 Shared dependencies and navigation expectations for core symbol tabs

- All three tabs live inside the same subject-detail shell and share the same subject header context, nested-route navigation model, and public-route assumptions already established for symbol detail.
- The core tab composition depends on hydrated subject identity, market quote and series services, fundamentals profile and statement services, aggregation outputs, and structured earnings events through backend contracts rather than direct provider payloads or chat-style tool loops.
- Moving between `overview`, `financials`, and `earnings` preserves subject context and shell chrome; it is a local section transition, not a new top-level workspace or a fresh subject-resolution flow.
- The tabs may link to one another through stable section destinations, but they must not collapse into one scrolling page or duplicate ownership of the same deterministic modules.
- Holders, signals, and `Analyze` entry points layer onto the same subject-detail shell through the dedicated integration and handoff rules below, and those additions must preserve the core tab responsibilities fixed in this bead.

### 3.4.3 Downstream consumer rules for core symbol tabs

- Holders, Reddit, and Analyze tab integration (`P1.3b`) depends on `overview`, `financials`, and `earnings` having stable deterministic responsibilities so later holders, Reddit, and Analyze entry points can attach without redefining the core symbol-detail tabs.
- Analyze template system (`P4.2`) depends on the explicit boundary between deterministic symbol tabs and later artifact-driven analysis so Analyze can launch from symbol detail without inheriting ownership of overview, financials, or earnings composition.
- Home feed (`P4.4`) depends on stable symbol-tab destinations and shared subject context so findings and summaries can deep-link into the right deterministic surface instead of inventing custom readouts per card.

### 3.4.4 Holders, signals, and Analyze entry integration

- `holders` remains the deterministic symbol-detail section for institutional and insider holder views tied to the selected subject.
- `holders` composes structured holder outputs from the fundamentals service and remains distinct from portfolio overlays, watchlist state, and user-owned monitoring context.
- `signals` remains the symbol-detail section for Reddit-like community views, news pulse, and future alt-data entry points; this bead does not replace that route bucket with a source-specific `reddit` shell contract.
- Reddit-like or news-specialized content inside `signals` composes evidence-backed blocks, claim clusters, evidence bundles, and trend-style renderers rather than raw social-text panes or provider-specific mini-pages.
- `Analyze` remains a top-level workspace rather than a durable nested symbol-detail section.
- Symbol detail launches `Analyze` with carried `SubjectRef` context or an explicit analyze intent, but resulting artifacts live on the shared snapshot and block plane rather than inside a persistent symbol-detail tab.

### 3.4.5 Navigation and handoff rules for holders, signals, and Analyze

- Entering `holders` or `signals` from symbol detail preserves subject context inside the same nested-route family and subject-detail shell.
- Launching `Analyze` from symbol detail is a workspace transition that still preserves carried subject context and does not reinterpret the subject from raw ticker text.
- The handoff from symbol detail into `Analyze` stays explicit so later shared-artifact and replay flows can point to durable snapshot-backed artifacts instead of scraped UI state.
- This bead does not redefine the core deterministic ownership of `overview`, `financials`, or `earnings`; it layers adjacent sections and launch points on top of that contract.

### 3.4.6 Downstream consumer rules for holders, signals, and Analyze entry work

- Analyze template system (`P4.2`) depends on explicit handoff from symbol detail into top-level `Analyze` with carried subject context so template and saved-workflow work can distinguish launch context from tab ownership.
- Shared artifact flow (`P4.3`) depends on `Analyze` entry from symbol detail producing artifact and snapshot boundaries outside the symbol-detail shell so add-to-chat or replay flows import a sealed artifact instead of scraping tab state.
- Specialized social and news blocks (`P4.6`) depends on Reddit-like entry living under `signals` and composing shared evidence-backed blocks so specialized social or news views do not redefine the symbol shell or bypass the block registry.

### 3.5 Analyze
Analyze is a saved, template-driven workflow with editable instructions, source categories, added subjects, and a memo-style block layout. It renders through the same `BlockRegistry` as chat and can be added to chat.

### 3.6 Watchlists and portfolio
Watchlists support `manual`, `screen`, `agent`, `theme`, and `portfolio` modes. Portfolio is lightweight holdings tracking for overlay context and monitoring, not brokerage execution.

### 3.7 Workspace shell and route skeleton

- The app uses one persistent workspace shell rather than surface-specific chrome for each page.
- The shell owns three regions: left navigation, main workspace canvas, and a right-rail slot.
- Left navigation holds the primary workspaces: `Home`, `Agents`, `Chat`, `Screener`, and `Analyze`.
- Shell chrome persists while moving between those primary workspaces.
- `Analyze` is a top-level workspace rather than only a symbol-detail tab.
- The right rail is a shell-owned slot rather than a surface-owned layout invention.
- `Home`, `Agents`, `Chat`, symbol detail, and `Analyze` use the right rail by default.
- `Screener` defaults to a denser main-canvas layout and may opt into the rail later without changing the shell contract.

### 3.8 Symbol-detail route skeleton

- Primary workspace route groups are `home`, `agents`, `chat`, `screener`, and `analyze`.
- These workspace route groups describe app navigation, not `/v1/*` HTTP endpoint groups.
- `Chat` remains thread-scoped rather than symbol-scoped because threads may span themes, multiple subjects, or imported Analyze artifacts.
- Symbol detail is an entered route group keyed by canonical subject identity rather than a primary left-nav workspace.
- Entering symbol detail swaps the main canvas into a subject-detail shell while preserving the surrounding shell chrome.
- The subject-detail shell owns shared subject header context and local section navigation.
- Nested routes are the durable model for subject-detail sections.
- The initial durable subject-detail sections are `overview`, `financials`, `earnings`, `holders`, and `signals`.
- `signals` is the extensible section for community, sentiment, news pulse, and future alt-data views.
- Symbol detail may deep-link into top-level `Analyze` with carried `SubjectRef` context or a prefilled analyze intent.

### 3.9 Downstream consumer rules for shell and route work

- Symbol search and quote snapshot surface (`P0.4`) depends on the distinction between primary workspaces and entered symbol-detail routes.
- Symbol overview shell (`P1.3`) depends on the subject-detail shell owning shared identity context and local section navigation.
- Symbol detail tabs and context modules (`P1.4`) depend on durable nested-route buckets inside the subject-detail shell.
- Thread coordinator and transport (`P2.1`) depends on `Chat` being a primary workspace inside the persistent shell.
- Analyze workspace surfaces (`P4.4`) depends on `Analyze` being top-level while still accepting deep-linked subject context.
- Right-rail activity (`P4.5`) depends on the shell-owned right-rail slot and selective default population.

### 3.10 Auth session and navigation guardrails

- The persistent workspace shell is not auth-gated as a whole. Unauthenticated users may enter the shell and navigate public research routes.
- Public browsing surfaces are `Home`, `Screener`, top-level `Analyze` entry, and entered symbol-detail routes.
- Public browsing may render market data, fundamentals, findings, and subject context that do not depend on user-owned state or persisted session history.
- Session-scoped workspaces and flows are `Chat`, `Agents`, watchlist views and mutations, persisted Analyze runs, saved prompts or templates, and any user-owned thread or run history.
- A route may be publicly enterable yet still host protected actions. Top-level `Analyze` may render only a public entry state with carried `SubjectRef` context, while any user-owned draft, save, or persisted-run state requires a session.
- Protected workspaces and routes use soft in-shell guards rather than replacing the shell with a separate auth-page model.
- Unauthenticated navigation to `Chat`, `Agents`, watchlists, or any other session-scoped route keeps shell chrome visible and replaces protected main-canvas content with an auth gate for that destination.
- The guard preserves intended destination context so successful sign-in can resume the same workspace, thread, agent view, watchlist view, or persisted run target.
- Public routes may launch protected actions through inline auth interrupts. Examples include `save to watchlist`, `start chat`, `open persisted run`, and any action that would create or reveal user-owned state.
- Inline auth interrupts preserve the current public route plus the pending action payload so sign-in can resume the action instead of forcing a route change.
- If a session expires or the user logs out inside a protected surface, protected content collapses to the same in-shell auth gate rather than redirecting away.
- Session loss preserves return-to context for the current protected route, but it must not continue rendering user-owned content after invalidation.
- Public routes remain navigable after logout or expiry without reconstructing the shell.
- Public surfaces continue to render public research context while protected panels and actions re-gate in place.
- The shell remains the durable navigation frame regardless of auth state; auth changes what the main canvas may reveal or mutate.
- This contract is written in terms of authenticated session scope rather than a specific identity or entitlement backend.

### 3.11 Downstream consumer rules for auth and session work

- Symbol overview and subject detail (`P1.3`) depends on the rule that entered subject detail may render public market, fundamentals, findings, and subject context without requiring a session.
- Screener surface and saved-screen handoff depends on `Screener` remaining publicly browsable inside the persistent shell while saved outputs and user-scoped handoffs require a session.
- Thread coordinator and transport (`P2.1`) depends on `Chat` being session-scoped even though it lives inside the same persistent shell as public routes.
- Agent management and scheduling depends on `Agents` and related user-owned configuration flows being session-scoped workspaces.

### 3.12 Symbol search and quote snapshot surface

- The persistent workspace shell owns the primary symbol search entry rather than delegating search behavior to each surface.
- Later flows such as add-to-watchlist or portfolio entry reuse the same shell-owned search contract rather than redefining symbol search per surface.
- Candidate handling reuses the existing search-to-subject flow: unique deterministic hits may auto-advance, ambiguous hits require explicit choice, and `not_found` ends without subject hydration.
- A successful subject resolution enters symbol detail rather than opening a detached quote page or staying inline in the originating workspace.
- The main canvas swaps into the entered subject-detail shell while preserving the surrounding workspace shell.
- The first quote snapshot is the initial landing state of entered symbol detail rather than a competing top-level workspace.
- The required landing content is a market identity strip plus a price-first quote snapshot.
- That minimum quote snapshot includes canonical subject display identity, listing-sensitive trading symbol context, latest price, absolute move, percentage move, freshness or session state, and a small recent-range or chart hook.
- Quote retrieval is listing-oriented even when the hydrated subject bundle also carries issuer context.
- A light issuer summary or profile companion is allowed when available, but it is best-effort and must not block the landing state.
- Lightweight downstream affordances such as watchlist entry or deeper symbol navigation may appear here, but they do not define full watchlist management or full symbol modules.
- This bead does not define earnings, holders, filings, peer tables, or a finished overview surface.

### 3.13 Downstream consumer rules for early symbol entry work

- Manual watchlist management baseline (`P0.4b`) depends on the reusable search entry and selected-subject handoff that manual watchlist actions will sit on top of.
- Portfolio and watchlist basics (`P1.5`) depends on the first quote and subject-entry behavior that later portfolio and watchlist basics reuse before overlays exist.
- Symbol overview shell (`P1.3`) depends on entered symbol detail having a thin initial landing state before fuller overview, financials, and earnings composition is defined.

### 3.14 Manual watchlist management baseline

- The product starts from one implicit default manual watchlist as the baseline saved-subject model.
- The manual baseline CRUD floor is membership-only: view current members, add a resolved subject, and remove a saved subject.
- This bead does not define create-list, rename-list, delete-list, sharing, reordering, or multiple manual lists.
- The persisted membership unit is canonical subject identity rather than raw ticker strings or stored quote payloads.
- Membership is idempotent at the subject level, so adding the same canonical subject twice does not create duplicates.
- Manual watchlist rows hydrate quote context on read from saved canonical subject identity rather than storing quote payloads in membership records.
- The row hydration contract is lightweight: subject display identity, listing-sensitive symbol context when applicable, latest price, absolute move, percentage move, and freshness or session state.
- Quote row hydration reuses the same listing-oriented market identity rule as early symbol entry rather than inventing a watchlist-specific quote identity model.
- Add-to-watchlist from public subject routes uses the existing inline auth interrupt contract: if the user is unauthenticated, the current route and pending resolved subject are preserved and the add resumes after sign-in.
- Removing a member changes watchlist membership only and does not mutate the underlying subject, quote snapshot, or later portfolio overlay state.

### 3.15 Downstream consumer rules for manual watchlist baseline work

- Portfolio and watchlist basics (`P1.5`) depends on the simple saved-subject baseline and quote row behavior that later portfolio and holdings surfaces build on.
- Dynamic watchlists and portfolio overlays (`P4.7`) depends on the manual list baseline that later derivation modes and overlay behavior extend rather than replace.
- Agent CRUD and scheduling (`P5.1`) depends on a simple, user-owned list object and membership model that later automation or agent creation flows may target without inventing a separate subject collection system.

### 3.16 Portfolio holdings model and overlay inputs

- Portfolio support remains lightweight research context: it tracks held exposure for overlays and monitoring, not brokerage execution, order management, tax lots, cash ledgers, or settlement workflows.
- A portfolio owns one explicit `base_currency` that defines the reporting currency for holding cost assumptions and later overlay totals.
- `base_currency` is a reporting and comparison assumption, not proof that the underlying listing trades in that currency and not a full FX accounting model.
- Holdings persist canonical market subject identity plus quantity, optional cost basis, and open or closed timestamps rather than raw ticker strings, provider payloads, or transaction histories.
- The holdings model does not require lot-by-lot reconstruction, realized tax accounting, fee capture, margin state, or order history.
- Manual watchlists and holdings remain separate: saving a subject does not create a holding, and holding a subject does not implicitly add it to a watchlist.

### 3.17 Downstream consumer rules for holdings model and overlay inputs

- Portfolio and watchlist surface behaviors (`P1.5b`) depends on the lightweight holdings scope and explicit `base_currency` assumption so first-surface behaviors can render held-state and cost context without inventing brokerage rules.
- Dynamic watchlists and portfolio overlays (`P4.7`) depends on holdings producing reusable overlay inputs rather than UI-owned ad hoc calculations so later overlay layers can merge portfolio context with watchlists, themes, screens, and subject views consistently.

### 3.18 Portfolio and watchlist first surface behaviors

- Manual watchlist and portfolio-held surfaces reuse the same thin quote-on-read row hydration contract rather than inventing separate quote-fetch behavior for held subjects.
- Portfolio-held rows layer held-state context, quantity, and optional cost-basis context on top of that shared quote row skeleton.
- The first surface behavior stays intentionally light: it does not define a portfolio analytics dashboard, brokerage position card, or private quote model distinct from symbol entry.
- If a subject is both watchlisted and held, the surface keeps both states visible rather than collapsing one concept into the other.
- Selecting a row from either a watchlist or portfolio-held surface enters the same symbol-detail route keyed by canonical subject identity.
- Entered subject views may show lightweight saved-state and held-state context plus adjacent actions, but that context augments the existing quote snapshot and subject modules rather than creating a portfolio-specific subject shell.
- Watchlist and holdings state remain user-owned overlay context on top of shared subject and market-data contracts.

### 3.19 Downstream consumer rules for portfolio and watchlist surface behaviors

- Dynamic watchlists and portfolio overlays (`P4.7`) depends on shared quote-row behavior and stable subject-view augmentation so later theme, screen, portfolio, and watchlist combinations can add more context without rewriting the base surfaces.
- Export and share policy (`P6.4`) depends on user-owned watchlist and holdings context staying visually and semantically distinct from canonical quote and subject content so later export or share rules can reason about what private overlay state may travel with a shared artifact.

### 3.20 Screener surface flow and saved-screen handoff

- `Screener` remains a primary workspace for building, refining, and viewing one active screen definition plus its current result set inside the persistent shell.
- The screener surface keeps query controls and result rows in one workspace flow rather than splitting query editing, results, and saved screens into separate primary surfaces.
- Public screener browsing may execute and refine unsaved screens without requiring a session, reusing the public-route and backend-owned screener query contract already defined elsewhere.
- Saving a screen, opening a user-owned saved screen, or mutating saved-screen metadata requires a session and uses the existing in-shell auth interrupt and resume behavior rather than leaving the screener route family.
- Saving a screen persists the replayable screen definition, user-owned screen record, and ordering semantics rather than a frozen cache of row payloads or a detached export artifact.
- Reopening a saved screen restores the screener workspace with the saved screen definition as the active query context and rehydrates results through the screener service rather than replaying stale table rows from client storage.
- Selecting a screener result row hands off canonical subject identity into the existing symbol-detail entry flow rather than opening a screener-specific quote view or embedding a full subject workspace inline.
- Handoffs from screener into later list or theme workflows carry explicit `screen` context or the saved query definition as the source reference so downstream derivation and theme flows can explain where a generated universe came from.
- This bead does not define dynamic watchlist derivation rules, theme membership inference, or bulk portfolio-overlay behavior; it only defines the screener surface flow and saved-screen handoff seam.

### 3.21 Downstream consumer rules for screener surface work

- Themes and macro subjects (`P4.1`) depends on screen-to-theme or derived-universe handoffs carrying explicit screen source context so later theme workflows can distinguish screen-derived membership inputs from manual or inferred membership.
- Dynamic watchlists and portfolio overlays (`P4.7`) depends on saved screens remaining replayable user-owned screen definitions with explicit source handoff so later dynamic watchlists can regenerate and explain screen-derived lists without scraping transient screener UI state.

## 4. Canonical domain model

### 4.1 Finance identity layer

```ts
Issuer {
  issuer_id: UUID
  legal_name: string
  former_names: string[]
  cik?: string
  lei?: string
  domicile?: string
  sector?: string
  industry?: string
  created_at: timestamp
  updated_at: timestamp
}

Instrument {
  instrument_id: UUID
  issuer_id: UUID
  asset_type: 'common_stock' | 'adr' | 'etf' | 'index' | 'crypto' | 'fx' | 'bond'
  share_class?: string
  isin?: string
  figi_composite?: string
  created_at: timestamp
  updated_at: timestamp
}

Listing {
  listing_id: UUID
  instrument_id: UUID
  mic: string
  ticker: string
  trading_currency: string
  timezone: string
  active_from?: timestamp
  active_to?: timestamp
  created_at: timestamp
  updated_at: timestamp
}
```

### 4.1.1 Canonical identity rules

- `Issuer` is the canonical identity for the legal and reporting entity.
- `Instrument` is the canonical identity for the tradable security definition issued by an issuer.
- `Listing` is the canonical identity for an exchange-specific venue representation of an instrument.
- `ticker` is a listing attribute and lookup handle, not canonical identity.
- ticker is a listing attribute and lookup handle, not canonical identity.
- Resolver entrypoints may start from ticker, alias, CIK, ISIN, or other external identifiers, but every downstream contract must promote the result into an explicit issuer, instrument, or listing identity.
- Downstream surfaces may display ticker strings for readability, but they must not persist or join on ticker where issuer, instrument, or listing identity exists.

### 4.2 Research subject layer

```ts
type SubjectRef =
  | { kind: 'issuer'; id: UUID }
  | { kind: 'instrument'; id: UUID }
  | { kind: 'listing'; id: UUID }
  | { kind: 'theme'; id: UUID }
  | { kind: 'macro_topic'; id: UUID }
  | { kind: 'portfolio'; id: UUID }
  | { kind: 'screen'; id: UUID }

Theme {
  theme_id: UUID
  name: string
  description?: string
  membership_mode: 'manual' | 'rule_based' | 'inferred'
  membership_spec?: json
  active_from?: timestamp
  active_to?: timestamp
}

ThemeMembership {
  theme_id: UUID
  subject_kind: SubjectKind
  subject_id: UUID
  score?: numeric
  rationale_claim_ids?: UUID[]
  effective_at: timestamp
  expires_at?: timestamp
}

Portfolio {
  portfolio_id: UUID
  user_id: UUID
  name: string
  base_currency: string
}

PortfolioHolding {
  portfolio_id: UUID
  subject_kind: SubjectKind
  subject_id: UUID
  quantity: numeric
  cost_basis?: numeric
  opened_at?: timestamp
  closed_at?: timestamp
}
```

`SubjectRef` selection rules:

- Use `issuer` for issuer research, filing-backed facts, company summaries, and issuer-scoped findings.
- Use `instrument` for security definitions that should survive listing changes, multiple venue representations, and share-class distinctions.
- Use `listing` for quotes, bars, session state, venue-sensitive performance, trading currency, and symbol-specific market context.
- `theme`, `macro_topic`, `portfolio`, and `screen` remain valid research subjects, but they do not replace entity identity when the subject is an issuer, instrument, or listing.

### 4.2.1 Portfolio holding and overlay input rules

- `Portfolio` is a user-owned research container, not a brokerage account surrogate.
- `Portfolio.base_currency` is required and interprets `cost_basis` plus any portfolio-level overlay totals in one explicit reporting currency.
- `PortfolioHolding` binds to canonical market identity, typically `instrument` or `listing`, and must not persist raw ticker strings or higher-order subjects such as `theme`, `macro_topic`, `portfolio`, or `screen` as holding identity.
- `cost_basis` is optional and, when present, is interpreted in the containing portfolio's `base_currency`; this bead does not define separate transaction currencies, FX lots, or fee-adjusted basis accounting.
- Overlay inputs derived from holdings are read models keyed by subject and contributing portfolio, not new canonical subject identities or stored UI payloads.
- The minimum overlay input contract is held-state, contributing `portfolio_id`, quantity, optional cost basis context, and a base-currency label for any derived valuation or gain/loss display.
- If multiple portfolios hold the same subject with different base currencies, this bead keeps those contributions distinct rather than silently netting them through an implicit FX layer.

### 4.3 Metrics and truth objects

```ts
Metric {
  metric_id: UUID
  metric_key: string
  display_name: string
  unit_class: 'currency' | 'percent' | 'count' | 'ratio' | 'duration' | 'enum'
  aggregation: 'sum' | 'avg' | 'point_in_time' | 'ttm' | 'yoy' | 'qoq' | 'derived'
  interpretation: 'higher_is_better' | 'lower_is_better' | 'neutral'
  canonical_source_class: 'gaap' | 'ifrs' | 'vendor' | 'market' | 'derived'
  definition_version: integer
}

Fact {
  fact_id: UUID
  subject_kind: SubjectKind
  subject_id: UUID
  metric_id: UUID
  period_kind: 'point' | 'fiscal_q' | 'fiscal_y' | 'ttm' | 'range'
  period_start?: date
  period_end?: date
  fiscal_year?: integer
  fiscal_period?: string
  value_num?: numeric
  value_text?: string
  unit: string
  currency?: string
  scale: numeric
  as_of: timestamp
  reported_at?: timestamp
  observed_at: timestamp
  source_id: UUID
  method: 'reported' | 'derived' | 'estimated' | 'vendor' | 'extracted'
  adjustment_basis?: 'unadjusted' | 'split_adjusted' | 'split_and_div_adjusted'
  definition_version: integer
  verification_status: 'authoritative' | 'candidate' | 'corroborated' | 'disputed'
  freshness_class: 'real_time' | 'delayed_15m' | 'eod' | 'filing_time' | 'stale'
  coverage_level: 'full' | 'partial' | 'sparse' | 'unavailable'
  quality_flags: string[]
  entitlement_channels: ('app' | 'export' | 'email' | 'push')[]
  confidence: numeric
  supersedes?: UUID
  superseded_by?: UUID
  invalidated_at?: timestamp
  ingestion_batch_id?: UUID
}
```

### 4.3.1 Truth and evidence role rules

- `Metric` is a definition object, not an observed value.
- `Fact` is the unit of truth for displayed values and must carry provenance, verification status, freshness, coverage state, and supersession state.
- `Computation` is the deterministic derivation record for a produced value and explains how displayed numbers were calculated from structured inputs.
- `Claim` is an extracted assertion from evidence and is not canonical truth.
- `Event` is the unit of state change assembled from claims and source references.
- `EntityImpact` routes a claim onto affected subjects for feed ranking, alerting, and agent relevance.
- `Finding` is a user-facing product artifact built from a sealed snapshot over the evidence graph.
- Documents are evidence, not truth.
- Facts are immutable except through supersession or explicit invalidation.
- Verification status remains attached to facts so downstream consumers can distinguish authoritative values from candidate, corroborated, or disputed values.

### 4.4 Claims, events, impacts, computations

```ts
Claim {
  claim_id: UUID
  document_id: UUID
  predicate: string
  text_canonical: string
  polarity: 'positive' | 'negative' | 'neutral' | 'mixed'
  modality: 'asserted' | 'estimated' | 'speculative' | 'rumored' | 'quoted'
  reported_by_source_id: UUID
  attributed_to_type?: 'issuer_mgmt' | 'journalist' | 'analyst' | 'tweet_author' | 'anonymous'
  attributed_to_id?: string
  effective_time?: timestamp
  confidence: numeric
  status: 'extracted' | 'corroborated' | 'disputed' | 'rejected'
}

ClaimArgument {
  claim_argument_id: UUID
  claim_id: UUID
  subject_kind: SubjectKind
  subject_id: UUID
  role: 'subject' | 'object' | 'customer' | 'supplier' | 'competitor' | 'regulator' | 'beneficiary' | 'constrained_party' | 'affected_party'
}

EntityImpact {
  entity_impact_id: UUID
  claim_id: UUID
  subject_kind: SubjectKind
  subject_id: UUID
  direction: 'positive' | 'negative' | 'mixed' | 'unknown'
  channel: 'demand' | 'pricing' | 'supply_chain' | 'regulation' | 'competition' | 'balance_sheet' | 'sentiment'
  horizon: 'near_term' | 'medium_term' | 'long_term'
  confidence: numeric
}

Event {
  event_id: UUID
  event_type: 'earnings_release' | 'guidance_update' | 'rating_change' | 'm_and_a' | 'split' | 'dividend' | 'product_launch' | 'lawsuit' | 'macro_event' | 'theme_event'
  occurred_at: timestamp
  status: 'reported' | 'confirmed' | 'canceled'
  source_claim_ids: UUID[]
  source_ids: UUID[]
  payload_json?: json
}

EventSubject {
  event_subject_id: UUID
  event_id: UUID
  subject_kind: SubjectKind
  subject_id: UUID
  role?: string
}

Computation {
  computation_id: UUID
  formula_id: string
  code_version: string
  input_refs: json
  output_ref: json
  created_at: timestamp
}
```

### 4.5 Sources, documents, mentions, clusters

```ts
Source {
  source_id: UUID
  provider: string
  kind: 'filing' | 'press_release' | 'transcript' | 'article' | 'research_note' | 'social_post' | 'upload' | 'internal'
  canonical_url?: string
  trust_tier: 'primary' | 'secondary' | 'tertiary' | 'user'
  license_class: string
  retrieved_at: timestamp
  content_hash?: string
}

Document {
  document_id: UUID
  source_id: UUID
  provider_doc_id?: string
  kind: 'filing' | 'transcript' | 'article' | 'research_note' | 'social_post' | 'thread' | 'upload'
  parent_document_id?: UUID
  conversation_id?: string
  title?: string
  author?: string
  published_at?: timestamp
  lang?: string
  content_hash: string
  raw_blob_id: string
  parse_status: 'pending' | 'parsed' | 'failed' | 'superseded'
  deleted_at?: timestamp
}

Mention {
  mention_id: UUID
  document_id: UUID
  subject_kind: SubjectKind
  subject_id: UUID
  prominence: 'headline' | 'lead' | 'body' | 'incidental'
  mention_count: integer
  confidence: numeric
}

ClaimEvidence {
  claim_evidence_id: UUID
  claim_id: UUID
  document_id: UUID
  locator: json
  excerpt_hash?: string
  confidence: numeric
}

ClaimCluster {
  cluster_id: UUID
  canonical_signature: string
  first_seen_at: timestamp
  last_seen_at: timestamp
  support_count: integer
  contradiction_count: integer
  aggregate_confidence: numeric
}

ClaimClusterMember {
  claim_cluster_member_id: UUID
  cluster_id: UUID
  claim_id: UUID
  relation: 'support' | 'contradict'
}
```

### 4.6 Snapshots, findings, activity, templates, chat

```ts
SnapshotManifest {
  snapshot_id: UUID
  created_at: timestamp
  subject_refs: SubjectRef[]
  fact_refs: UUID[]
  claim_refs: UUID[]
  event_refs: UUID[]
  series_specs: json
  source_ids: UUID[]
  tool_call_ids: UUID[]
  as_of: timestamp
  basis: 'unadjusted' | 'split_adjusted' | 'split_and_div_adjusted' | 'reported' | 'restated'
  normalization: 'raw' | 'pct_return' | 'index_100' | 'currency_normalized'
  coverage_start?: timestamp
  allowed_transforms: json
  model_version?: string
  parent_snapshot?: UUID
}

Finding {
  finding_id: UUID
  agent_id: UUID
  snapshot_id: UUID
  subject_refs: SubjectRef[]
  claim_cluster_ids: UUID[]
  severity: 'low' | 'medium' | 'high' | 'critical'
  headline: string
  summary_blocks: Block[]
  created_at: timestamp
}

RunActivity {
  run_activity_id: UUID
  agent_id: UUID
  stage: 'reading' | 'investigating' | 'found' | 'dismissed'
  subject_refs: SubjectRef[]
  source_refs: UUID[]
  summary: string
  ts: timestamp
}

AnalyzeTemplate {
  template_id: UUID
  user_id: UUID
  name: string
  prompt_template: string
  source_categories: string[]
  added_subject_refs: SubjectRef[]
  block_layout_hint?: json
  peer_policy?: json
  disclosure_policy?: json
  version: integer
  created_at: timestamp
  updated_at: timestamp
}

ChatThread {
  thread_id: UUID
  user_id: UUID
  primary_subject_kind?: SubjectKind
  primary_subject_id?: UUID
  title?: string
  latest_snapshot_id?: UUID
  created_at: timestamp
  updated_at: timestamp
}

ChatMessage {
  message_id: UUID
  thread_id: UUID
  role: 'user' | 'assistant' | 'tool'
  snapshot_id: UUID
  blocks: Block[]
  content_hash: string
  created_at: timestamp
}
```

## 5. Evidence and document handling

### 5.1 Ingestion pipeline

```text
Acquire raw document
  -> Canonicalize
  -> Parse
  -> Entity-link
  -> Reader extraction
  -> Claims / impacts / candidate facts / events
  -> Cluster / corroborate / promote
  -> Snapshot / findings / blocks / alerts
```

### 5.2 Promotion rules by source class
- Filing and issuer disclosure may create authoritative facts.
- Transcript and earnings-call commentary typically create claims and events; facts become authoritative only when tied to formal disclosure or validated extraction rules.
- News articles and research notes generally create claims, events, candidate facts, and impacts; they do not directly create authoritative facts unless matched to a primary source.
- Tweets, Reddit posts, and similar social sources create claims, sentiment, and leads only.
- User uploads create user-scoped evidence unless promoted by explicit validation workflows.

### 5.3 Multi-entity reasoning
A document can mention multiple subjects. The reasoning unit is the claim plus its arguments and `EntityImpact` edges. Routing, alerting, and theme assignment should rely on claims and impacts rather than bare document mention tags.

## 6. Service boundaries

### 6.1 Identity and resolver service
Owns issuer, instrument, listing, theme, macro-topic, and subject resolution.

- The resolver is the deterministic boundary that converts user-entered lookup input and provider-origin identity records into canonical finance identity outputs.
- The resolver owns normalization, candidate generation, canonical reference selection when unambiguous, and explicit ambiguity preservation when multiple canonical targets remain plausible.
- The resolver is distinct from search UI, user disambiguation flow, and downstream subject hydration.
- Every successful resolver path must end in explicit canonical refs rather than ticker strings or raw provider ids standing in for identity.
- The resolver must promote lookup handles into issuer, instrument, listing, or `SubjectRef` outputs that downstream systems can persist and join on safely.
- The contract defines a typed resolution envelope rather than an untyped candidate list.
- `resolved` means the resolver can name one canonical target confidently enough for deterministic downstream use.
- `ambiguous` means multiple canonical issuer, instrument, listing, or `SubjectRef` targets remain plausible after normalization and matching, so the resolver must return ranked candidates without silently picking one.
- `not_found` means the resolver could normalize the input but could not map it to a supported canonical target.
- The contract explicitly covers two input families: user-entered lookup text and provider-origin identity records.
- User-entered lookup text includes ticker-like strings, issuer names, aliases, and other concise finance lookup inputs.
- Provider-origin identity records include external ids and structured provider payload fields such as ticker, exchange, CIK, ISIN, or other identifier-bearing records.
- The resolver must normalize input before matching, but normalization must not erase identity-level distinctions between issuer, instrument, and listing.
- The resolver may start from ticker or alias lookup, but downstream output must promote that lookup into explicit issuer, instrument, listing, or `SubjectRef` candidates.
- Ticker-only identity remains insufficient because the same symbol can map to different listings, venues, or securities, and issuer-level workflows often need a different canonical target than market-data workflows.
- The resolver should expose the ambiguity axis when possible, such as issuer-versus-listing ambiguity or multiple plausible listings for one ticker string.
- Ranked candidates are advisory metadata, not permission to silently collapse ambiguity into one winner.
- `resolved` should include the canonical identity level that was chosen so downstream systems know whether they received issuer, instrument, listing, or already-formed `SubjectRef` output.

### 6.1.1 Downstream consumer rules

- Search-to-subject resolution flow (`P0.3b`) depends on the resolver outcome vocabulary it will carry through candidate search, user choice, and downstream subject hydration.
- Market data service (`P1.1`) depends on the rule that quote and bar consumers must receive listing-appropriate canonical output rather than ticker strings or issuer-level guesses.
- Fundamentals service (`P1.2`) depends on the rule that issuer-backed fundamentals cannot rely on ticker-only identity and must consume issuer-appropriate canonical output or preserved ambiguity.
- Screener surface and saved-screen handoff depends on deterministic subject identity shapes even before later hydration flow is applied.
- Pre-resolve router and budget policy (`P2.2`) depends on the rule that deterministic pre-resolve routing consumes resolver envelopes rather than asking the model to silently choose among ambiguous identity candidates.

### 6.1.2 Search-to-subject resolution flow

- Search-to-subject flow is the deterministic orchestration that carries lookup input from candidate search through canonical selection into downstream-safe subject hydration.
- The staged flow is candidate search, canonical selection, and hydrated subject handoff.
- Candidate search may return zero, one, or many candidates, but it must not invent a silent winner from ambiguous matches.
- If candidate search yields exactly one deterministic candidate that already satisfies the resolver contract, the flow may auto-advance to canonical selection without a separate chooser step.
- If multiple plausible candidates remain, the flow must pause at explicit ambiguity preservation and surface ranked candidates for later user or caller choice.
- Canonical selection consumes either the auto-advanced unique candidate or an explicit chosen candidate and normalizes it into canonical subject identity.
- `not_found` ends the flow without subject hydration.
- Only a `resolved` outcome may produce hydrated subject handoff.
- The hydrated subject bundle includes the canonical `SubjectRef`, the resolved identity level, stable display labels, normalized lookup input, resolution path (`auto_advanced` or `explicit_choice`), and enough issuer, instrument, or listing context for immediate downstream use.
- Watchlists, chat turns, Analyze entry, and service-to-service calls consume the same hydrated subject bundle contract even if they later project only the fields they need.
- One hydrated bundle may carry joined issuer and active listing context, but the canonical `SubjectRef` remains the durable key.
- Downstream systems persist the canonical `SubjectRef` and treat the rest of the hydrated bundle as entry context that may be refreshed later.

### 6.1.3 Downstream consumer rules for search-to-subject flow

- Symbol search and quote snapshot surface (`P0.4`) depends on symbol search entry points, explicit candidate-choice rules, and hydrated subject handoff for quote snapshots.
- Market data service (`P1.1`) depends on listing-appropriate subject handoff into quote and bar retrieval rather than ticker-string lookup.
- Fundamentals service (`P1.2`) depends on issuer-appropriate subject handoff into statement and metric normalization instead of rediscovering identity downstream.
- Pre-resolve router and budget policy (`P2.2`) depends on deterministic subject handoff so chat turns start from canonical subject context rather than ad hoc model interpretation of search strings.
- Watchlist and saved-subject entry flows depend on the same hydrated subject bundle contract so selected subjects can be saved, reopened, and re-entered without rediscovering identity from raw lookup text.

### 6.2 Market data service
Owns quotes, bars, corporate actions, aligned performance series, and market session state.

### 6.2.1 Quote and bar provider abstraction

- Market data service is the sole internal boundary for quote and bar provider interaction.
- Downstream consumers call the market data service or analyst tools rather than provider SDKs, raw provider endpoints, or provider-specific payload helpers.
- Quote and bar retrieval start from listing-appropriate hydrated subject context or a listing `SubjectRef`, not from raw ticker strings, venue text, or provider identifiers standing in for canonical market identity.
- Provider adapters normalize provider-specific response shapes, identifiers, rate limits, and availability quirks into stable internal market records before those records reach downstream consumers.
- The provider-neutral contract preserves `as_of`, `delay_class`, `currency`, and `source_id` for quote and bar retrieval, plus `adjustment_basis` whenever a bar response has already crossed an adjustment boundary.
- Corporate actions remain part of the market data service domain, but this bead only establishes that provider normalization may depend on them; adjusted-series and cache semantics belong to `P1.1b`.
- Quote retrieval owns the latest listing-oriented market snapshot for a tradable subject.
- The normalized quote contract covers latest price, absolute move, percentage move, freshness or session state, `as_of`, `delay_class`, `currency`, and `source_id`.
- Quote retrieval is lightweight and snapshot-oriented; it does not answer historical range questions, adjusted-series questions, or comparison normalization.
- When the hydrated subject bundle also carries issuer context, quote retrieval still resolves the active market snapshot from listing context rather than treating issuer identity as sufficient on its own.
- Provider failures, stale data, or missing market coverage should surface as normalized market-data availability outcomes rather than raw provider error payloads leaking to callers.
- Bar retrieval owns ordered intraday and historical OHLCV series for a listing-oriented subject across a requested range and interval.
- The normalized bar contract exposes requested subject identity, range, interval, `as_of`, `delay_class`, `currency`, `source_id`, and `adjustment_basis`.
- Bar retrieval owns provider normalization for ordered timestamps, venue-sensitive session interpretation, and basic corporate-action-aware bar shaping needed to produce one stable internal series shape.
- This bead does not define which adjustment policies are available to users or how cache keys are formed; it only requires the bar contract to make the resulting adjustment basis explicit whenever bars are served.
- Comparison charts, adjusted-series APIs, and snapshot-safe transform rules consume this bar contract later rather than bypassing it with provider-specific chart fetches.

### 6.2.2 Downstream consumer rules for quote and bar provider abstraction

- Adjusted series query and caching surface (`P1.1b`) depends on the provider-neutral quote and bar boundary, normalized market metadata fields, and the explicit split between snapshot reads and ordered time-series retrieval.
- Symbol detail surfaces (`P1.3`) depends on a stable quote snapshot contract and reusable bar retrieval boundary so symbol modules do not embed provider-specific market fetch logic.
- Pre-resolve router and budget policy (`P2.2`) depends on the distinction between lightweight quote reads and heavier historical-bar reads so routing and budget policy can choose the right market-data cost class without guessing from provider names or ticker text.
- Scale hardening (`P6.5`) depends on a provider-neutral market-data seam with explicit freshness and source metadata so bottleneck audits, caching, and hardening work optimize the boundary rather than coupling consumers to one upstream vendor.

### 6.2.3 Adjusted series query and caching semantics

- Adjusted series query is the market-data surface above raw bar retrieval that produces comparison-ready or interactive time series from canonical listing subject input.
- Series queries bind explicit `subject_refs`, `range`, `interval`, `basis`, and `normalization` before execution, caching, and snapshot binding.
- Market-series basis remains explicit: `unadjusted`, `split_adjusted`, and `split_and_div_adjusted`.
- The service must not silently mix bases inside one returned series set, one chart artifact, or one comparison response.
- Multi-subject performance responses share one basis, one normalization, one `as_of`, and one requested range contract even when coverage start differs by subject.
- Series responses expose the effective coverage window and any partial or unavailable history explicitly rather than backfilling missing periods or implying full coverage.
- Cache is an internal optimization behind the market data service, not a separate semantic source of truth for charts, symbol tabs, or blocks.
- Cache identity includes the canonical subject set, range, interval, basis, normalization, and freshness boundary used for the series request.
- A cache hit may reuse prior series material only when the request preserves subject membership, basis, normalization, and does not require data newer than the request or snapshot `as_of`.
- Cache hits and misses must return the same observable contract: stable series semantics, explicit `as_of`, preserved basis or `adjustment_basis`, and the same provenance-facing metadata as uncached reads.
- If basis, normalization, peer set, or freshness changes, the system treats that as a different series request and refreshes or recomputes rather than mutating a cached answer in place.
- In-snapshot transforms may reuse cached series only when the requested range or interval is already legal under the sealed snapshot manifest and remains inside `allowed_transforms`.
- Changing basis or normalization is out-of-snapshot behavior even if compatible cached material exists somewhere in storage.

### 6.2.4 Downstream consumer rules for adjusted series query and caching

- Symbol detail surfaces (`P1.3`) depends on explicit basis and coverage semantics so price charts and comparison modules do not silently switch between adjusted and unadjusted histories.
- Block registry and initial block catalog (`P2.3`) depends on stable series query identity and in-snapshot cache reuse rules so interactive blocks know which transforms are legal without redefining market semantics per block kind.
- Specialized social and news blocks (`P4.6`) depends on the same series semantics and cache contract for trend-style blocks so source-specific renderers reuse shared market rules rather than inventing bespoke chart caching behavior.
- Non US identity data and coverage gaps (`P6.2`) depends on explicit basis, coverage-window, and partial-history rules so later international work can surface venue and provider differences without pretending uniform history quality.
- Scale hardening (`P6.5`) depends on the declared cache identity and refresh rules so audits and ops work optimize hit rate and storage layout without weakening snapshot correctness.

### 6.3 Fundamentals service
Owns company profile, statements, ratios, holders, insiders, estimates, and fiscal-calendar normalization.

### 6.3.1 Statement and metric normalization

- Statement normalization is the fundamentals-service layer that turns filing-backed or vendor-backed statement inputs into canonical value objects keyed by metric definitions.
- Statement reads begin from issuer-appropriate subject context rather than listing identity or ticker-only lookup.
- The service normalizes the three core statement families explicitly: `income`, `balance`, and `cashflow`.
- Statement basis remains explicit at the query and output boundary: `as_reported` and `as_restated` are different normalization modes and must not be silently merged.
- Period selection, fiscal labels, scale normalization, and unit normalization are part of the statement-normalization contract rather than caller-specific cleanup work.
- `Metric` remains the canonical definition object for what can be measured, how a value is interpreted, and which source class a normalized value belongs to.
- Fundamentals service owns the mapping from normalized statement lines into canonical metric definitions, but it does not turn `Metric` into a mutable value store.
- Displayed statement values resolve to `Fact` rows when the value is directly observed or promoted as truth, and to `Computation` rows when the value is deterministically derived from structured inputs.
- Statement normalization must not introduce a second truth layer made of UI-only statement cells or provider-specific blobs that bypass `Fact` and `Computation`.
- When source material is incomplete, conflicting, or pending promotion, the service preserves coverage and verification state through canonical value objects rather than inventing complete normalized tables.

### 6.3.2 Downstream consumer rules for statement and metric normalization

- Later aggregation layer (`P1.2b`) consumes normalized issuer statement facts and canonical metrics so later aggregation work builds on one shared value layer without redefining statement normalization.
- Symbol detail surfaces (`P1.3`) depends on normalized statement outputs carrying explicit basis, period, and coverage semantics so overview, financials, and earnings tabs can render trustworthy tables and charts.
- Pre-resolve router and budget policy (`P2.2`) depends on the issuer-oriented normalization boundary so routing can distinguish fundamentals reads from market-data reads before the tool loop starts.
- Promotion rules for candidate facts (`P3.5`) depends on the rule that normalized statement values become `Fact` or `Computation` objects rather than a separate fundamentals-only truth store, so promotion and supersession work target the canonical value plane.
- Non US identity data and coverage gaps (`P6.2`) depends on explicit metric ownership, basis handling, and issuer-oriented normalization rules so later international work can extend accounting mappings without weakening the canonical value contract.

### 6.3.3 Stats, segment, and consensus aggregations

- The fundamentals aggregation layer sits above normalized statement facts and canonical metrics and produces reusable read models for key stats, segment facts, analyst consensus, and comparison-ready derived outputs.
- Aggregation outputs are service-level views, not replacements for canonical `Fact` or `Computation` rows, and they must keep their derivation inputs, freshness, and coverage assumptions explicit.
- Key stats and derived ratios may combine normalized fundamentals, market context, and deterministic computations, but they must expose the basis, period, and `as_of` assumptions needed to explain each value.
- Segment facts remain distinct from consolidated statement outputs: they carry segment axis, segment definitions, period context, and coverage warnings instead of flattening segment disclosures into issuer-level statement tables.
- Analyst consensus remains distinct from both reported statements and promoted evidence facts: rating distributions, price-target summaries, analyst counts, and coverage warnings are service-level aggregates with explicit `as_of` semantics.
- Comparison-ready derived outputs may package reusable aggregate slices for peer views or ranking-style surfaces, but they must not become an opaque cache of UI-specific payloads.
- When aggregation inputs are incomplete, stale, or inconsistent, the service surfaces warnings and partial-coverage metadata instead of fabricating complete comparisons or silently filling gaps.
- The aggregation layer may read canonical facts, computations, and provider-backed consensus or segment inputs, but provenance, supersession, and truth-promotion state remain owned by the canonical value plane.

### 6.3.4 Downstream consumer rules for aggregation outputs

- Symbol detail surfaces (`P1.3`) depends on separate stats, segment, and consensus aggregation families so overview, financials, and earnings modules can reuse deterministic read models instead of rebuilding UI-specific payloads from raw statements.
- Pre-resolve router and budget policy (`P2.2`) depends on the distinction between normalized statement reads and aggregation-layer reads so routing can classify heavier fundamentals requests before the tool loop starts.
- Specialized social and news blocks (`P4.6`) depends on reusable key stats and consensus outputs so narrative product blocks can cite stable aggregate envelopes without embedding ad hoc ratio or target-calculation logic.
- Segment extraction refinement (`P6.1`) depends on segment aggregates preserving axis, definition, and coverage-warning semantics so harder extraction cases can evolve without changing the consumer-facing aggregation contract.
- Non US identity data and coverage gaps (`P6.2`) depends on aggregation outputs keeping basis, freshness, and coverage assumptions explicit so later international expansion can widen issuer and provider coverage without pretending the aggregates are uniformly comparable.

### 6.4 Evidence service
Owns sources, documents, mentions, claims, claim arguments, impacts, events, facts, computations, clusters, snapshots, provenance, and evidence bundles.

### 6.4.1 Downstream consumer rules for truth and evidence objects

- Fundamentals consumes `Metric`, `Fact`, and `Computation` as the canonical value layer and may read claims or events only for explanatory context.
- Evidence extraction owns `Source`, `Document`, `Mention`, `Claim`, `ClaimArgument`, `ClaimEvidence`, `ClaimCluster`, `Event`, and `EntityImpact`.
- Home feed consumes Finding, SnapshotManifest, and ClaimCluster as the deduped product artifact layer.
- Agent workflows consume `SnapshotManifest`, `Finding`, `RunActivity`, `ClaimCluster`, and `EntityImpact`.
- Reader and extraction flows may ingest raw documents; analyst and user-facing flows must operate on structured facts, claims, events, snapshots, findings, and evidence bundles instead of raw untrusted text.

### 6.5 Filing extraction platform
Owns filing retrieval, section parsing, extension handling, segment extraction, footnote extraction, management claim extraction, event detection, and reviewer queues.

### 6.6 Search service
Owns symbol typeahead, corpus retrieval, and evidence-bundle assembly.

### 6.7 Screening service
Owns screens, ranking, saved filters, and dynamic universe generation.

### 6.7.1 Screener query model and result contract

- Screener queries are explicit structured filter-and-rank envelopes rather than a freeform analytics DSL or arbitrary user-authored formulas.
- The minimum query dimensions are universe constraints, market or quote constraints, fundamentals or aggregate constraints, sort specification, and page or limit controls.
- Query clauses bind to screener-owned fields backed by the market-data and fundamentals services rather than exposing raw provider payload columns or frontend-computed joins.
- A screener response is an ordered derived result set rather than a new canonical identity type for returned entities.
- Each result row carries canonical market subject identity, display identity, ranking or sort context, and compact quote or fundamentals summaries sufficient for screener-table rendering.
- Screener rows remain thinner than symbol-detail hydration: selecting a row hands off canonical subject identity for later subject-entry flows rather than embedding a full symbol workspace payload.
- A reusable `screen` subject represents the persisted query definition plus ordering semantics, not a frozen list of prehydrated row payloads.
- The Screener service owns query validation, execution, ranking, pagination, and row-envelope assembly.
- `/v1/screener/*` remains the client boundary for screener queries and results, even when the service internally reads market-data and fundamentals outputs.
- Clients must not reconstruct screener tables by fanning out across `/v1/market/*` and `/v1/fundamentals/*` and inventing their own join semantics.

### 6.7.2 Downstream consumer rules for screener query work

- Screener UI flow and saved-screen handoff (`P1.4b`) depends on stable query envelopes and result-row semantics so later screener surface and saved-screen work can reuse one service-owned screener contract instead of inventing a second client-side model.
- Dynamic watchlists and portfolio overlays (`P4.7`) depends on screen definitions remaining replayable, service-owned query objects so later dynamic watchlists can regenerate a screen universe without scraping transient UI state or storing raw row payloads as truth.

### 6.8 Home feed service
Owns cross-agent findings feed generation, cluster dedupe, and ranking.

### 6.9 Notification service
Owns email, push, SMS, and digest delivery.

## 6A. Relational schema contract

### Reference and universe tables

- `issuers`, `instruments`, `listings`, `themes`, `theme_memberships`, `portfolios`, `portfolio_holdings`, `watchlists`, and `watchlist_members` define reusable subject context and membership state.
- This family supports identity resolution, subject scoping, and user-curated universes without becoming part of the evidence graph.

### Evidence-plane relational tables

- `metrics`, `sources`, `documents`, `mentions`, `claims`, `claim_arguments`, `entity_impacts`, `claim_evidence`, `claim_clusters`, `claim_cluster_members`, `events`, `event_subjects`, `facts`, `computations`, `snapshots`, `findings`, `run_activities`, `citation_logs`, `verifier_fail_logs`, and `eval_run_results` form the relational evidence plane.
- This family holds provenance, auditability, promotion state, snapshotted findings, and the fact or claim or event model that downstream services depend on directly.

### App metadata and orchestration tables

- `users`, `chat_threads`, `chat_messages`, `analyze_templates`, `agents`, and `tool_call_logs` support user state, orchestration, and workflow coordination around the evidence plane.
- These tables may reference snapshots, findings, or subject refs, but they do not replace the canonical evidence-plane tables.

### Storage split

- App metadata may live in smaller app storage such as D1 or Postgres, depending on deployment constraints.
- Evidence objects and snapshots belong to the relational evidence plane and should live in Postgres-class storage that preserves relational integrity and auditability.
- Raw document bytes are outside the relational schema.

### Snapshot bridge

- `snapshots` are evidence-plane records rather than ordinary app metadata.
- Snapshots seal the refs that support answers and findings at a specific `as_of`.
- Snapshots bridge the evidence plane to user-facing artifacts.

## 7. API contracts

The normative API surface is defined in `finance_research_openapi.yaml`.

Top-level API endpoint groups:
- `/v1/subjects/*`
- `/v1/market/*`
- `/v1/fundamentals/*`
- `/v1/evidence/*`
- `/v1/snapshots/*`
- `/v1/chat/*`
- `/v1/analyze/*`
- `/v1/agents/*`
- `/v1/home/*`
- `/v1/watchlists/*`
- `/v1/screener/*`

### 7.1 HTTP API ownership and consumer rules

- `Subjects`, `Market`, `Fundamentals`, `Evidence`, `Snapshots`, `Chat`, `Analyze`, `Agents`, `Home`, `Watchlists`, and `Screener` are the stable endpoint groups exposed to clients.
- The frontend only talks to `/v1/*` backend contracts.
- The frontend does not call third-party providers directly.
- `Chat` plus `Snapshots` define the run, stream, and render boundary.
- Interactive updates such as snapshot transforms, chat streaming, and market refreshes stay inside backend-managed endpoints rather than bypassing the API layer.

## 8. Block model

Assistant output is always a `Block[]` envelope. The normative JSON Schema is in `finance_research_block_schema.json`.

Key design rules:
- blocks are typed artifacts, not rendered HTML
- `RichText` binds to facts, claims, and events by reference
- `Section` is first-class and holds child blocks
- `PerfComparison` is snapshot-aware and transform-aware
- `Sources` is required whenever external evidence was used
- `Disclosure` can be injected by the orchestrator

### 8.1 Block schema contract and render rules

- Assistant output is always a typed `Block[]` response envelope, not plain markdown and not a tool call.
- Every block kind inherits the `BaseBlock` contract: `id`, `kind`, `snapshot_id`, `data_ref`, `source_refs`, and `as_of`.
- The canonical schema field is `data_ref`.
- Earlier analysis used `dataRef` or `queryRef`; the schema standardizes this as `data_ref`.
- Narrative and layout blocks: `rich_text`, `section`
- Tabular and compact metric blocks: `metric_row`, `table`
- Chart and comparison blocks: `line_chart`, `revenue_bars`, `perf_comparison`, `segment_donut`, `segment_trajectory`, `metrics_comparison`, `sentiment_trend`, `mention_volume`
- Research and evidence summary blocks: `analyst_consensus`, `price_target_range`, `eps_surprise`, `filings_list`, `news_cluster`, `finding_card`
- Trust and rendering-boundary blocks: `sources`, `disclosure`
- `Sources` is the required provenance surface whenever external evidence appears in the answer.
- `Disclosure` is the explicit trust and compliance surface and may be injected by orchestration.
- `as_of` is the freshness boundary for the rendered artifact.

### 8.2 Downstream consumer rules for block artifacts

- Thread coordinator and transport (`P2.1`) consumes `Block[]` as the streamed and persisted assistant payload.
- Block registry versioning and validation (`P2.3`) consumes the exact block kinds plus the shared `BaseBlock` fields.
- Snapshot assembler and verifier (`P2.4`) consumes `snapshot_id`, `source_refs`, `data_ref`, and `as_of` to verify rendered artifacts against sealed evidence.
- Findings, home feed, and explainability (`P4.2`, `P4.3`, `P4.6`) consume `finding_card`, `sources`, `disclosure`, and the same snapshot-safe render rules used in chat and analyze.
- Frontend renderer (`PX.3`) consumes `Block[]` via a shared `BlockRegistry` and must not treat rendering as a tool invocation.
- Chat, Analyze, and agent-produced findings all render through the same `BlockRegistry`, keyed by block `kind`.
- Interactivity stays inside snapshot scope unless the user explicitly refreshes.

## 9. Tool registry

The normative analyst tool registry is in `finance_research_tool_registry.json`.

### 9.1 Tool registry and bundle rules

- `spec/finance_research_tool_registry.json` is the normative artifact for bundle membership, tool audience, approval sensitivity, and JSON-schema-constrained inputs and outputs.
- Tools are backend data and action surfaces; `Block[]` remains the response artifact contract.
- The system chooses the bundle; the model chooses tools within the bundle.
- Bundle groups: `quote_lookup`, `single_subject_analysis`, `peer_comparison`, `theme_research`, `segment_deep_dive`, `document_research`, `filing_research`, `screener`, `agent_management`, `alert_management`, and `analyze_template_run`.
- `reader` tools are the only tools allowed to access raw untrusted text or raw documents.
- `analyst` tools operate only on structured outputs, canonical subject and period resolution, evidence bundles, facts, claims, events, and approval-mediated write intents.
- Raw text must not leak into analyst-facing tools.
- Approval-sensitive tools today are `create_alert` and `create_agent`.
- `add_to_watchlist` is a non-read-only write-intent tool even though it is not currently approval-required.

### 9.2 Downstream consumer rules for tool runtime

- Pre-resolve routing and budget policy (`P2.2`) depends on deterministic bundle selection, audience separation, and registry metadata before the analyst loop starts.
- Document ingestion and extraction (`P3.2`) depends on raw document search, fetch, and extraction tools belonging to the `reader` audience.
- Alerting and automation (`P5.1`) depends on side-effect categories and approval sensitivity so create and update flows do not execute directly from model output.
- Tool runtime and orchestration (`PX.2`) depends on bundle membership, audience, `read_only`, `approval_required`, `cost_class`, and `freshness_expectation`.

## 10. Snapshot semantics

### 10.1 Sealed snapshot manifest

- A sealed snapshot pins the subject set, `as_of`, basis, normalization, coverage window, source set, bound fact / claim / event refs, and exact `allowed_transforms`.
- `allowed_transforms` is explicit manifest state, not a UI guess derived from block kind alone.
- Snapshot sealing happens only after binding and disclosure verification.
- Persisted chat and analyze artifacts must continue to point at that sealed snapshot rather than reconstructing support opportunistically later.

### 10.2 In-snapshot transforms

- A transform is legal inside a sealed snapshot only when it preserves the subject set and does not require fresher evidence than `as_of`.
- In-snapshot transforms may change presentation or range only when the required rows or series are already inside the sealed data boundary.
- Changing `YTD` to `1Y` on a performance chart is allowed only if the requested range end is less than or equal to `as_of`.
- The manifest, not the client, determines whether a transform is allowed.

### 10.3 Refresh and new-run boundary

- Any request that changes subject membership, peer set, basis, normalization, or freshness crosses the snapshot boundary.
- Requests for fresher data, different peers, different basis, or different normalization require refresh or a new run.
- Crossing the snapshot boundary must be explicit rather than a silent mutation of a sealed answer.

### 10.4 Downstream consumer rules for snapshot semantics

- Block registry versioning and validation (`P2.3`) depends on snapshot rules being stable enough to know which interactions are legal within existing block bindings and which require a new backend result.
- Snapshot assembler and verifier (`P2.4`) depends on the sealed manifest contents, sealing order, and refresh boundary to prove that rendered blocks still correspond to the same evidence-backed snapshot.
- Shared artifact flow (`P4.3`) depends on sealed snapshots remaining reusable product artifacts.
- Frontend renderer (`PX.3`) depends on presentation-only interactions staying local only when they remain inside the sealed snapshot contract.

## 11. Key workflows

### 11.1 Chat turn
1. Resolve subjects and period
2. Select bundle
3. Run analyst tool loop
4. Stage snapshot manifest
5. Verify bindings and disclosures
6. Seal snapshot
7. Stream `Block[]`
8. Persist message, snapshot, citations, and summary

### 11.2 Analyze template run
1. Load template
2. Resolve source categories into tool bundle and policy
3. Add primary subject plus template-added subjects
4. Run analyst
5. Seal snapshot
6. Persist analysis artifact
7. Optionally add artifact to chat thread

### 11.3 Agent run
1. Load due agents
2. Retrieve new documents and facts since watermark
3. Run reader extraction and clustering
4. Relevance-rank by thesis
5. Run analyst on relevant evidence
6. Create findings and activities
7. Evaluate alerts
8. Advance watermark transactionally

### 11.4 Home feed query
1. Load active agents
2. Pull recent findings
3. Dedupe by claim cluster
4. Rank by recency, severity, and user affinity
5. Return collapsed cards with expandable details

## 12. Build order

### Phase 1
- issuer/instrument/listing resolver
- market data service
- US fundamentals via SEC and market provider
- structured block renderer
- basic chat orchestrator and snapshots

### Phase 2
- document pipeline
- reader extraction
- evidence bundles
- claims, events, impacts, clusters

### Phase 3
- themes and macro subjects
- Analyze templates
- Home feed and activity stream
- dynamic watchlists and portfolio overlays

### Phase 4
- agents and notifications
- non-US coverage
- reviewer queues
- richer analytics and exports

## 13. Files in this artifact set
- `finance_research_spec.md` — this narrative spec
- `finance_research_db_schema.sql` — relational schema pack
- `finance_research_openapi.yaml` — HTTP API contracts
- `finance_research_block_schema.json` — block output schema
- `finance_research_tool_registry.json` — analyst and reader tool registry
