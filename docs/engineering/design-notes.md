# Design Notes

Working notes for contributors and agents: decisions that are easy to get wrong and not obvious from the code.
Migrated from beads memories on 2026-09-30. Promote a note to `docs/adr/` when it becomes a durable decision.

## Deterministic seals for fact-built blocks

Pure-deterministic snapshot seals (DB facts, zero `tool_call_id`s), e.g. Analyst Grid cells, are exempted from the
tool-call provenance audit via the `DETERMINISTIC_SNAPSHOT_MANIFEST` symbol set by `buildFactBackedSealInput`
(`services/snapshot/src/seal-input.ts`; moved from `services/analyze/src/block-seal-input.ts` on 2026-06-11, and
analyze re-exports it). `auditManifestToolCallLog` (`services/snapshot/src/manifest-staging.ts`) skips the
`missing_provenance` check for these.

- **LLM-derived blocks** use `buildClaimBackedSealInput` (same file): a STAGED-only manifest, never DETERMINISTIC, so
  the tool-call audit applies. `result_hash` comes from `writeToolCallLog`'s `RETURNING` (canonical `hashJsonValue`);
  never hand-roll it.
- Both builders spread `stagedManifestBase()`; object spread carries the symbol keys.
- **Why:** DB facts are already provenanced by `fact.source_id`, which the verifier's fact→source binding check
  enforces. The tool-call audit exists for LLM-tool-derived content.
- Analyze's merged seals are unaffected: `seal-input-merge` spreads only `base.manifest` symbols, never DETERMINISTIC.
- Approved by the project owner on 2026-06-09.
- **Gotchas:** grid cell provenance blocks must use a REGISTERED block kind (`metric_row` for facts, `rich_text` for
  reader cells). A `point`-period fact needs a temporal anchor for the fact-binding check: an undated point fact
  (`period_end` null) binds by `as_of`, and a dated legacy point fact binds by `period_end`
  (`requiredFactBindingFields` in `services/snapshot/src/snapshot-verifier.ts`; covered by
  `services/snapshot/test/point-fact-binding.test.ts`). Do not invent a `period_end` for undated facts.

This is the path the chat-recovery epic uses to seal chart and table blocks built from facts.

## What a block's label claims (#193)

Each block in a chat message carries three independent claims. They are not a trust score.

- **Evidence binding (`linked`/`unknown`):** every value the block cites is in its sealed snapshot's manifest. These
  are the refs the seal verifier checks, plus sealed series. Linkage means the values shown are the evidence cited:
  the seal accepts a single fact binding on any block, which says nothing about literal values.
  - A `table` of literal cells, or a chart of literal points (`line_chart`, `segment_trajectory`, `sentiment_trend`,
    `mention_volume`), is never linked. The seal drops these charts' points without comparing them with their sealed
    series.
  - A price chart (`perf_comparison`) is the exception (#236). The seal reloads the bars each line's series pins,
    recomputes the line with the function chat draws it with, and fails on any digest, point or window mismatch
    (`series_points_mismatch`). It also fails unless each line's legend name and subject label are its listing's
    stored ticker and its unit is `%` (#316). The chart is linked when its points are embedded and each line has its own sealed
    series. A live-rendered chart, with no embedded points, is never linked.
  - A price return in prose is a `series` ref (#317). The seal fails unless it shows the last point of the line that
    series draws in the message's price charts, as the chart labels it (`series_ref_format_mismatch`). The prose is
    linked only if each series it cites was sealed with the point check.
- **Calculation (`verified`/`not_verified`):** the server recomputed the result from its recorded inputs. Only a
  `financial_answer` qualifies, and only one whose run, unit and `presentation_hash` have a certificate
  (`snapshot_financial_runs`) in that snapshot.
- **Public by cutoff (`proven`/`unknown`):** the exact source versions were public by the knowledge cutoff. This
  rests on the same certificate, because the financial verifier seals a unit only when every input's publication
  proof is public by the cutoff. A fact or bar stored by the cutoff (its `as_of`) does not prove this.

How the claims are produced and shown:

- **On the server:** `deriveBlockProof` (`services/snapshot/src/block-proof.ts`) computes the claims on every
  message read, and `listChatMessagesForThread` returns them as `block_proofs`. They sit beside the blocks, never
  in them, so nothing stored in a block, sent by a client, or written by the model can set one.
- **Missing proof:** with no sealed snapshot, or refs the seal cannot read, every claim is unknown or not verified.
- **In the web app:** `BlockView` labels a block from its proof. An ordinary fact table or chart reads
  "Source-linked"; a certified answer reads "Verified calculation" plus "Public by cutoff". Commentary that cites
  nothing gets no label. The block inspector explains each claim separately.
- **Elsewhere:** surfaces without proofs, including chat blocks still streaming, keep their kind's default label.

## Home secondary sections: server-side composition

Home secondary sections are composed server-side in `services/home/` by four functions:

- `getHomeMarketPulse`: an injected `quoteProvider` plus `pulse_subjects`.
- `getHomeWatchlistMovers`: the default manual watchlist, listing-kind members only, the top 5 by `|change_pct|`,
  with the signed delta retained.
- `getHomeAgentSummaries`: raw SQL on `agents` / `findings` / `agent_run_logs`, with no coupling to `services/agents`.
  Enabled agents only; 24h finding counts by severity; the latest high/critical headline.
- `getHomeSavedScreens`: `ScreenRepository` top 5 by `updated_at`. The internal name is `saved_screens`; there is no
  pinning schema.

The orchestrator `getHomeSummary` returns all four plus the findings feed. The HTTP route is `GET /v1/home/summary`,
served by `createHomeServer(db, deps)` following the `services/watchlists` pattern.

Verification is per-section service tests, an HTTP test, and a frontend render test against a mock payload; there is
no full-stack test.

## Unverified chat answers in development

`CHAT_VERIFICATION_MODE` (`services/chat/src/runtime.ts`) controls what happens when an answer fails verification.

- **`strict`** (default, and always used by the golden test): the turn ends with `turn.error`, and nothing is shown or
  saved.
- **`display_unverified`**: for debugging charts and tables while they're being built. The coordinator still streams
  the blocks, then emits `turn.completed` with no `message_id` and an `unverified: { persisted: false, failures, blocks }`
  payload. The web client labels each block "Unverified" and lists the failure reason codes under "Why unverified".

A saved answer's `turn.completed` instead carries `message`: the saved message read back through the same code as
the thread's messages GET (`readChatMessage` in `services/chat/src/messages.ts`), so the web client shows the sealed
answer without fetching the thread (#331).

This covers both failure points: the runtime's own verification, and the snapshot seal at persistence (a
`ChatSnapshotSealError` carrying the verifier's failures). Other persistence errors, such as a lost database
connection, are still `turn.error`.

**Decision: unverified answers are never persisted.** Saving them would put an unsealed answer in the thread
history next to verified ones, and the evidence inspector only works on sealed snapshots. An unverified answer
disappears on reload, which is acceptable for a debugging mode. The server refuses to start with `display_unverified`
when `NODE_ENV=production`.

## Charts and tables in chat answers

Chat answers carry deterministic fact blocks (`services/chat/src/fact-blocks.ts`). For a resolved company, those are
a latest-quarter `metric_row` and a `revenue_bars` chart covering 8 quarters. Both are built from reported facts
through the shared eligibility reader (`loadRecentIssuerFundamentals`), with no model involvement. Block choice is a
fixed rule, not a tool loop.

- Every value cites its fact (`value_ref`), and the fact is bound in `data_ref.params.fact_bindings`. Bindings come
  from the same loader the seal verifies with (`loadVerifierFactsForRefs`), so they match by construction. Only facts
  that loader returns are rendered.
- **Chat seals one snapshot per message.** Fact blocks join the message's existing staged manifest: their facts go in
  via `provenance_fact_refs`, and the tool-call audit still applies to the narrative. They don't use
  `buildFactBackedSealInput`, which seals per block. `normalizeAssistantBlock` keeps `data_ref.params`, and fact
  blocks don't inherit the narrative's default claim/document refs, because the verifier would then demand those
  sources on the chart.
- **Judge gate** (`inference-judge.ts`, `answer-trace.ts`): the answer is rendered from its checked assertions, each
  figure a packet value in a template; an analyst inference is the model's words, with no digit or reference. A
  second model (`JUDGE_LITELLM_MODEL`) reads each inference beside the assertions it rests on, one call per
  inference, all at once (#376). The answer is sealed and shown at once with a line in each inference's place
  (`answer.shown`); as each verdict arrives, `answer.shown` comes again for the same message with that inference
  shown or its line gone, and the answer is saved once every verdict is in, with the inferences found entailed.
  Each shown state and the save may differ from the seal only in text segments, which neither the seal nor a block
  proof reads (`messages.ts`). No judge configured, a failed or late call, or no verdict: that inference is not
  shown. The judge replaced the word-list narrative guard (#302).
- The displayed figures reach the model in its evidence packet (`displayedFigures`, `fact-blocks.ts`;
  `evidence-packet.ts`), each with an id and the company and metric it belongs to. The model cites a figure only by
  its id (`[[F3]]`); the answer renders the packet's value in a template, so no figure is the model's words.
- A failure while building fact blocks degrades to a narrative-only answer; it never costs the user the answer.

## Cash flow, balance sheet and EPS (#205)

SEC ingestion stores three statement families. An income lookup downloads the issuer's companyfacts, and the same
filing's cash flow and balance sheet are extracted from it and stored in the same transaction
(`companionStatements`, `services/fundamentals/src/sec-facts-repository.ts`).

- **Which value is the filing's:** a 10-K or 10-Q repeats prior periods under its own `fy`, `fp` and accession. Its own
  period is the one ending last (`ownPeriodFirst`, `services/fundamentals/src/sec-edgar.ts`). Before this, annual
  selection took the oldest comparative and quarterly selection preferred a framed prior-year quarter.
- **A filer's `fy` can be wrong:** NVDA tagged its FY2021 Q1 and Q2 10-Qs `fy=2020`. Every period is bounded by its
  fiscal year's dates (`secFiscalYearWindow`): the year's own 10-K period, or before that 10-K is filed, up to 53 weeks
  after the previous one. A value ending outside is another year's; a mislabelled quarter is then a gap, not a wrong
  year.
- **A full year is 350 to 380 days.** A pre-2021 10-K also tags its fourth quarter alone as `fp=FY`, ending the same day.
- **Cash flow is year to date in a 10-Q:** a quarter is its year to date less the previous one, and Q4 is the year less
  nine months. Derived quarters carry no source token, like a derived income Q4.
- **A derived quarter names every filing it comes from.** Its source is the statement's filing, but its inputs usually
  span filings (Q2 cash flow is the Q2 10-Q's six months less the Q1 10-Q's three; an income Q4 is the 10-K's year less
  three 10-Qs). Its `quality_flags` hold a `sec_period_difference` lineage: each input's accession, period, value and
  filing `source_id`, every one registered as a source. Chat adds those sources to the block showing the figure
  (`withDerivationSources`, `services/chat/src/fact-blocks.ts`), so the inspector reaches every filing.
- **A balance is a point** at the filing's period end. The statement contract labels every point `FY` of its fiscal
  year, so readers date a balance by `period_end`, never by its fiscal label. The chat block's figures tell the model it
  is a "balance at period end" (`displayedFigures`). The model's other facts (`availableFigures` in
  `services/chat/src/llm-runtime.ts`, its figures when no block shows one) leave out cash flow and balances altogether (`excludeMetricKeys`, `local-runtime-structured.ts`): there a balance would read as its fiscal
  label, and the extra rows would crowd income facts out of the 24-row cap.
- A family that cannot be extracted or mapped is logged and left out; only a database failure fails the ingestion.
- **Mapped:** operating cash flow, capex (`PaymentsToAcquirePropertyPlantAndEquipment`, else NVDA-style
  `PaymentsToAcquireProductiveAssets`), cash and equivalents, total assets, liabilities and equity. **Not mapped:**
  total debt (filers split it across tags, so it needs a reviewed definition), EBITDA, dividends.
- **Backfill:** a period whose income facts were stored earlier is read from facts without a download, so a lookup
  never adds its other families. `npm run backfill:sec-statements [-- <issuer_uuid> ...]` (in `services/fundamentals`)
  stores them for every SEC income period on file, one companyfacts download per issuer
  (`backfillSecCompanionStatements`), paced under SEC's fair-access rate. It also **repairs** the income statement: a
  stored fact whose value or dates differ from the filing (written by the old selector) is invalidated, the filing's
  fact is stored, and the old one is `superseded_by` it, in the filing's transaction. A stored income fact whose metric
  the filing no longer yields for the period is invalidated too when its dates are another period's. A snapshot cut before the repair
  still reads the old fact (`factActiveSql` judges activity at the cutoff). A rerun keeps a matching fact's value, and
  one with no proven precision gains a `revalidated_against_source` proof. The CLI skips the frozen golden dataset's issuers.
  Lineage for derived income quarters stored before it existed is not rewritten.

In chat, a single-company question naming cash flow, capex, free cash flow, the balance sheet or one of its items
(cash, total assets, liabilities, equity or book value), or EPS reads them (`services/chat/src/statement-blocks.ts`). A question asking only for them takes the `statements`
route and reads nothing else.

- **One company at a time:** a comparison asking now only for them is a named gap (`unavailable_metric`), with no
  income figures in their place. Kept from an earlier turn, they don't stop a comparison asked for now.
- **A block shows the items asked for**, not its whole family: "how much cash" shows cash, and with no cash figure
  names the gap rather than showing another balance. Free cash flow comes with the two figures it is computed from.
  An item dropped later stays dropped; dropping one item of the whole balance sheet keeps the others, named.
- **A qualified metric is its own gap:** "free cash flow margin", "EPS growth" or "FCF per share" name a metric no
  reader serves, never the plain figure. So do adjusted figures ("adjusted EPS", "non-GAAP free cash flow", "non-GAAP
  operating income"): the reported GAAP figure never stands in for them. "Cash flow from investing (or financing)
  activities" is that category, a gap, never operating cash flow.
- **Periods:** cash flow shows the latest quarter and fiscal year; the balance sheet its latest period end; EPS (diluted;
  basic only when asked for by name, never diluted in its place) the latest quarter or, once the 10-K is in, the year
  (a fourth quarter's EPS is never derived). A fiscal year the question
  names limits each to that year. "Drop the cash flow" drops capex and free cash flow too.
- Free cash flow is operating cash flow less capex, for the same dates in one currency. It is minted as a derived fact
  that states its currency and cites both inputs.
- The blocks are ordinary fact-bound `metric_row`s, so they read "Source-linked". Like every other chat figure they are
  not "Verified calculation": that label still needs the financial engine's certificate (#200, #211).

## Which facts may ground an answer

`loadUsableFacts` (`services/fundamentals/src/usable-facts.ts`) is the one definition (#159). Every reader that shows
figures goes through it, directly or via `loadRecentIssuerFundamentals`. Its rules:
- **eligibility:** reported, active, entitled for the channel, display-verified;
- **numeric** values only (by default);
- **dated:** a fiscal period has its year and period;
- **currency:** a currency fact states its currency, never assumed;
- **coverage** (`fullCoverageOnly`, opt-in): only fully covered facts, chosen before canonicalization so a newer partial
  fact never displaces an older full one. Chat's quarterly blocks use it (#239);
- **canonical:** one fact per subject, metric and period, the latest `as_of` winning;
- **cutoff** (when given): `as_of`, `observed_at` and `reported_at` at or before it, so a snapshot never uses what wasn't
  yet known.

A new data path adds only what's specific to it (e.g. segment hierarchy and reconciliation) and passes the snapshot's
`asOf` as `cutoff`. "Known at a cutoff" is one SQL helper, `factKnownAtSql` (`services/evidence/src/fact-activity.ts`),
shared by `loadUsableFacts`, the SEC statement/stats repositories (comparison inputs) and
`loadVerifierFactsForRefs` (`requireKnownByCutoff`). Derived facts the comparison materializes are stamped at the
cutoff (`clock`), so they pass the same check (#161). The rules are tested together in `services/fundamentals/test/usable-facts.integration.test.ts`.

## Management's explanations and guidance (#205)

An answer may state a cause only as management's own attribution from a cited claim (`llm-runtime.ts`), and those
claims used to be keyword hits, so most "why" questions got "the data does not show why". Earnings releases say why:
an 8-K Item 2.02 files the press release and CFO commentary as EX-99 exhibits
(`services/evidence/src/sec-earnings-release-extraction.ts`).

- **Candidates:** Item 2.02 claims (`material_event.guidance_update`, written by the 8-K handler) whose `enriched_at`
  is unset. High-severity 8-K enrichment reads other predicates, so the two never share a claim. `enriched_at` marks
  each processed, rowCount-guarded like the enrichment, so a concurrent run is a no-op.
- **The model picks, the filing decides.** The model gets the EX-99 exhibits as plain text (tags dropped, entities
  decoded, typographic quotes and dashes made plain) and returns up to 8 `{kind, metric, quote}`: kind explanation or
  guidance, metric from a closed list. A quote is kept only if it appears verbatim in an exhibit (in that canonical
  form) as whole sentences: it starts at a block edge or after a sentence's end, and ends at a block edge or with its
  own end mark (a full stop counts only before what a sentence starts with, and never an abbreviation's, so neither
  "the U.S. due to" nor "the U.S. Data Center market" is a boundary). So a clause cut from a sentence ("decline due to weaker demand" out of "Revenue did not decline due
  to weaker demand") is rejected, while a sentence after a heading block is whole. (A plain-text exhibit's blocks are
  its paragraphs, with an all-caps heading line its own.) The stored text is the exhibit's own, never the model's
  string. Paraphrases and invented causes are dropped. A reply that isn't JSON leaves the filing unprocessed, to be
  read again by the next run.
- **Claims:** `management.explanation.<metric>` or `guidance.<metric>`, modality `quoted`, attributed to the issuer,
  dated by the filing, confidence 0.8 (the words are verified; reading them as an explanation is the model's). A
  `claim_evidence` row locates each one (exhibit, character span, quote hash).
- **Chat** reads `management.explanation.` claims first (not `management.tone`) on every route that reads figures (latest quarter, trends, margins,
  segments, statements, comparisons: `ROUTE_PREDICATES`, `evidence-packet.ts`); other routes take the newest claims.
  The explanation of what the question asks about comes before the others (`explainedMetrics`: margins, then each
  metric named), since one release can hold more explanations than the claim limit. The scope reads revenue, margins
  and income as the whole income statement, so it also records the items the question names (`income_items`:
  "operating income"), and theirs come first. A question asking for guidance
  ("guidance", "outlook", "forecast", "expects", "projections", "target"; not "than expected": the scope's `guidance`,
  kept by follow-ups until one turns it off) reads guidance claims first instead, for the metrics it names and then
  any, whatever the figures' route; one asking why as well (`explains`) reads management's explanation of those
  metrics at the same priority. The loader ranks claims by the
  first of the route's prefixes they match, so this order is the priority (`local-runtime-evidence.ts`); a group of
  prefixes shares one where the scope doesn't record which was named (an operating income, net income or expenses
  question is read as the income statement, so its explanations rank together; so do the margins'). Within a
  priority, each predicate (and each company) takes its turn, newest first, so no one metric fills every slot.
  A question about a fiscal year reads its guidance as given during the year (the full year's comes with the last
  year's results) and the releases
  about that year first: from the end of its first quarter until a quarter after it ends, by the issuer's own fiscal
  year where its facts date it (calendar bounds from the label otherwise), so later releases don't crowd it out. The
  window is a year, not the quarter asked about.
- **Run it** after the 8-K crawl: `npm run extract:earnings-releases` (in `services/evidence`). It is a batch step,
  never the crawl: one model call per release (more for one over 60,000 characters, split between blocks, so its
  tail is read too), at low reasoning; about 46 s on the dev model in a probe (4 minutes at
  its default reasoning).
- **Not yet:** guidance compared with the reported result once it is in, 10-Q/10-K MD&A, and the frozen golden
  dataset has no such claims (the eval's "why" question still answers from figures alone).

## What a chat turn asks for

What a turn asks for and turns off is read by a model, proposed from closed vocabularies
(`services/chat/src/scope-proposal.ts`): its metrics (free cash flow, adjusted EPS, a balance item...), its facets
(peers, segments, margins or their trend, a benchmark, guidance, a cause, evidence, the latest quarter) and the
income-statement items it names. English patterns in `research-scope.ts` missed phrasings one review at a time
("cash used in operating activities", "lower than expected", "without guidance"), so they are gone.

- **The model only proposes.** One call returns JSON: `metrics` (catalog keys from `PROPOSABLE_METRICS`, each with an
  optional adjustment and qualifier), `asks` (`SCOPE_FACETS`), `turns_off` (facets, a fiscal year or quarter, and
  metrics) and `income_items` (`INCOME_ITEMS`). `parseProposal` checks every key; anything outside the vocabularies,
  malformed or cut off rejects the whole proposal. It never picks companies, periods, data or figures, and nothing
  it writes reaches the answer.
- **Fixed syntax stays code.** Periods come from token readers (`FY2026`, `Q3`, `the third quarter`, `YTD` in
  `fact-blocks.ts` and `research-scope.ts`), companies from the coordinator, and the route, inheritance and what a
  turn-off clears are derived from the proposal in `resolveResearchScope`. A field turned off is never also asked for.
- **No proposal** when there is no model, the call fails or takes longer than one 12 s attempt (`SCOPE_DEADLINES`),
  the reply is invalid, or `CHAT_SCOPE_PROPOSAL=off`. The turn then asks for nothing new: a follow-up keeps the
  previous answer's scope whole and reads what it read, and a fresh question gets the plain answer for its companies (the latest quarter for
  one, a comparison for several) and its period tokens. One `[chat] no scope proposal (<reason>)` warning names why.
- **A financial-engine answer** saves its scope with no proposal, so its turn waits on no extra model call. Its
  metrics are the ones the published plan computed (`planMetrics` in `financial-runtime.ts`), so a follow-up reads
  those figures.
- **The live eval** is a test: `test/fixtures/scope-eval-cases.json` holds 115 questions with the previous answer's
  scope and the scope each should resolve to, `scope-eval-replies.json` a live model's reply to each, and
  `test/scope-eval.test.ts` resolves the replies with no model. After a prompt change, `npm run scope:eval`
  (`scripts/scope-eval.ts`) asks the live model again and prints each case that no longer resolves as expected.
- **Recorded replies** (`LLM_REPLAY_FILE`) answer it like any other call: each recorded conversation (the golden
  replies, each holdout case's `scopes`) records one reply per question, matched by `proposalQuestion`, and those
  suites fail on any turn that answered without one.
- **Cost:** one short call per turn, awaited beside the previous scope's read; 3-9 s on the dev model in a probe.

## Which companies a chat turn covers

`resolveTurnSubjects` (`services/chat/src/coordinator.ts`) decides a turn's companies, primary first:

1. The **whole message** is resolved first, so a bare ticker, a company name, or a theme behaves as before.
2. Otherwise, **every ticker** the message mentions is resolved (`extractSubjectMentions`), de-duplicated by canonical
   issuer (two listings of one company count once), and capped at 5.
3. The **previous answer's companies** are prepended when the message names none ("explain the differences") or is
   comparative ("compare it with AMD", "vs", "against", "peers"). They come from the last assistant message's sealed
   snapshot `subject_refs`, re-hydrated via `hydrateSubjectRef` (`services/chat/src/thread-context.ts`). Naming a new
   company without comparing replaces them ("analyze AAPL and its margins").

A turn with an **explicit subject** (`subjectText`, e.g. a thread opened from a ticker page) must resolve it or gets a
clarification turn. That subject is primary; a comparative message adds the companies it names by the same rules
(ambiguous one asks, one not found is named in the answer, de-duplicated, capped at 5). A non-comparative message
covers the explicit subject only.

The turn's fact blocks follow from that list:
- one company gets the metric row and revenue chart;
- two or more get a `metrics_comparison` of the latest fiscal year, via analyze's peer pipeline (key stats, then the
  materializer, then the builder);
- one company plus "peers" uses the industry peer set (`createSqlPeerSetResolver`);
- one company plus "segment(s)" adds a `metric_row` "Revenue by segment (…)" for the latest quarter that has segment
  facts. A segment is a `segments` row (issuer, axis, name), and its revenue is a fact with `subject_kind = 'segment'`,
  `subject_id = segment_id` (#157). So each value is an ordinary cited fact, and consolidated readers
  (`subject_kind = 'issuer'`) never see segment rows. No segment facts means no block, and the narrative says the
  breakdown isn't available.

A block that names its own subjects (a comparison's issuers) adds them to the snapshot's subject refs. The model also
sees the last 6 messages of the thread. The price-performance chart is tracked separately (#133).

## Sealed price series (`perf_comparison`)

A comparison of two or more listed companies also gets a price-performance chart (`services/chat/src/perf-block.ts`).
Each company's line comes from its latest stored daily bar range (`market_bar_ranges` / `market_bars`),
normalized to percent return. The companies' windows must be identical, or there is no chart.

- **Price basis (#191):** all lines use one adjustment basis that every company has, `split_adjusted` first, then
  `split_and_div_adjusted`.
  - Polygon's aggregates are split-adjusted only. A chart on them is titled a price return, and a disclosure says that
    dividends are not included.
  - If the companies share no basis, a short note names each company's basis in place of the chart.
  - Polygon ranges cached under the old `split_and_div_adjusted` label (before #191) are never read. The chart and the
    market cache share `MISLABELED_POLYGON_RANGE_SQL`. Those ranges are not rewritten either, so snapshots sealed
    from them still verify.
- **Requests name a basis:** bar requests carry their `adjustment_basis`. An adapter that can't produce it answers
  `missing_coverage`, so the fallback chain tries the next provider.
  - Polygon serves `split_adjusted` and `unadjusted`.
  - Stooq serves `split_and_div_adjusted`.
  - yfinance serves both adjusted bases.
  - Web price charts request `split_adjusted`.
- **Year to date (#192):** a question that says "YTD" or "year-to-date" charts that window instead of the latest
  stored range. The rules live in `services/market/src/ytd-window.ts`.
  - The baseline is the final completed close before January 1 of the cutoff's exchange-local year. The end is the
    latest completed session (from 16:00 local), and every company must have both the same baseline and the same end.
  - Returns are `(close - baseline) / baseline * 100`. Sessions that not every company traded are skipped and counted
    in the label, never filled.
  - Each company's line comes from a stored range that starts by Dec 24 of the prior year, so an unrelated newer
    range can't change the window. Each series spec seals the window and a digest of exactly the bars drawn.
  - Anything short of a full window is a named gap, never a shorter window called YTD: a missing baseline, a listing
    after the year began, a zero baseline, mismatched sessions, a missing endpoint, or mixed bases.
  - So is a full window that is not current at the turn's cutoff (#256): it must end within a week of the last
    completed session (`isCurrentEnd`), judged at the cutoff, not today. This stops a failed or stale refresh from
    passing off an old cached window as this year to date. Frozen data modes skip this check and chart the golden
    window, which ends 2026-08-31.
  - The chart only reads stored bars. In live mode (#232), a YTD turn first asks the market service
    (`MARKET_ORIGIN`, `/v1/market/series`) for the window, from Dec 20 of the prior year to now. The request goes
    through the cached adapter, so the bars are fetched, stored and reused.
  - The fetch tries split-adjusted bars first. If any company lacks them, it fetches dividend-adjusted bars for
    every company, so one basis can chart them all.
  - The fetch is time-limited and never fails the turn. The turn captures its cutoff only afterwards.
  - Frozen data modes (`DEV_NO_KEYS=true`, `DEV_MODE=analyst`) never fetch, so live bars can't mix into the golden
    dataset.

- **Sealing:** every series has a `series_specs` entry in the snapshot manifest. The entry holds the `series_ref`, the
  bar range's `source_id`, `listing_id`, `bar_range_id`, interval, range and `as_of`. The block cites these through
  `data_ref.params.series_refs` and lists the sources in `source_refs`, which is what the verifier requires of
  `perf_comparison` (`requiresSealedDataSupport`).
- **The points travel in the block** (`series`, a schema addition along with `subject_labels`). The web draws a sealed
  block exactly as sealed, with no live `/v1/market/series` fetch and no range toggle, because only one window is
  sealed. Blocks without `series` keep the live behaviour. Other ranges for a sealed answer would need the ADR-0002
  transform/refresh flow.

