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
  second model (`JUDGE_LITELLM_MODEL`) reads each inference beside the assertions it rests on and the answer's
  other observations and comparisons, one call per inference, all at once (#376). Its verdict is entailed,
  unsupported, contradicted or worded_amount (`SHOWN_AS`): entailed shows as an analyst inference, unsupported
  shows labelled as an unverified analyst view, and the others stay hidden. The answer is sealed and shown at once
  with a line in each inference's place (`answer.shown`); as each verdict arrives, `answer.shown` comes again for
  the same message with that inference shown or its line gone, and the answer is saved once every verdict is in.
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

## EPS and share counts on a split basis (#387)

A filing states its own period's EPS and weighted-average share counts on the split basis of its filing date: every
split executed on or before that date is already reflected. SEC ingestion certifies them that way
(`recordSecOriginalContext`, `services/fundamentals/src/sec-facts-repository.ts`).

- **Stored as filed:** the context's adjustment basis is `as_filed`, with the filing date companyfacts lists beside the
  value (`as_filed_on`, migration 0066) and the basic or diluted share basis. Publication proofs cannot date the filing,
  since they prove only when a fetch saw it.
- **Bound on the analysis's basis:** an as-filed input binds `split_adjusted` with a `split_adjustment.v2`
  (`services/financial-core/src/split-adjustment.ts`). It names the listing and its time zone, the listing's splits
  after the filing date and on or before the reference date, their factor, and the restated value, as exact fractions.
  The token and its proof stay as filed. Polygon dates a split by the trading day in the listing's market, so the
  reference date is the plan cutoff's date in the listing's time zone (`listings.timezone`), not in the plan's
  `cutoff_timezone`. A plan has one cutoff instant and each listing one reference date, so a company's restated inputs
  always compare. Core derives the date from the plan's cutoff and the recorded zone, rebuilds the adjustment from its
  own splits, and fails the input's integrity on any difference.
- **Gaps:** no single common-stock listing active at the cutoff (`split_listing_unresolved`), splits never fetched
  (`split_history_missing`), or last fetched before the reference date in the listing's zone (`split_history_stale`).
  The check proves only that the list was fetched on or after that day. Such a list holds every split executed by the
  reference date only if the provider lists each split before or on its execution date.
- **A split recast is no restatement:** a later 10-K states an earlier year's as-filed figure on its own split basis.
  Restatement detection restates the previous filing's figure by the listing's splits between the two filing dates
  (`explainedBySplits`). When that rounds to the later figure at the finer of their decimal places, the later figure is
  the same one, and nothing is stored. NVDA's FY2024 diluted EPS of 11.93 is 1.193 after the 10-for-1 split, and the
  FY2025 10-K presents it as 1.19. Otherwise the later figure is an economic restatement as filed on its 10-K's date,
  so binding restates it from there. When the listing's splits are not on file through the later filing's date (no
  single listing on that date, never synced, or synced before it), the figure is stored as an `unverified_restatement`
  (migration 0067). An `as_restated` plan gaps on it with `restatement_unverified`, and an `as_reported` plan still
  binds the original.
- **Seal:** the snapshot verifier rebuilds the adjustment from the listing's current splits and time zone and withholds
  the seal when either changed (`splits_changed`).
- **Saved rules:** a thesis condition or Discovery criterion on a per-share value or share count is unresolved
  (`threshold_has_no_split_basis`, `services/financial-engine/src/saved-rule.ts`). Its threshold names no split basis
  date, so compared with a value restated to the evaluation date it would flip on a split's date.
- **Operators:** `npm run backfill:sec-statements` records the context of a share fact stored before #387, and
  `npm run sync:splits` (in `services/market`) has to have run on the analysis's day. Every ingest compares the stored
  originals again, so a backfill rerun after a sync decides each unverified restatement whose listing's splits now
  cover its filing date, and a second rerun changes nothing.

## Shares outstanding from the cover page (#444)

A 10-K or 10-Q cover page states the registrant's common shares outstanding as of its own date S, days before the
filing date D (dei `EntityCommonStockSharesOutstanding`). SEC ingestion stores it as the engine's `shares_outstanding`
(`secCoverCount`, `services/fundamentals/src/sec-facts-repository.ts`).

- **Fact:** a point at S with the filing's fiscal year, fiscal period and accession, filed on D (`reported_at`), with
  the lossless token and publication proof every SEC token fact gets.
- **Anchored at S, not D:** the count is a literal count at S. A split after S is not in it, though the same filing's
  statements reflect every split by D. Its context is `as_filed` on S with the definition's share basis
  (`not_applicable`), so binding restates it by the splits after S.
- **Latest filing only** (`selectShareCount`, `services/financial-engine/src/select-inputs.ts`): a node binds the count
  of the newest filing filed by the cutoff, apart from the plan's statement periods. Any other count is `stale_input`,
  as is one dated more than `SHARE_COUNT_MAX_AGE_DAYS` (130) before the cutoff, since a large accelerated filer's
  filings are due about 112 days apart at most. When the latest filing's count cannot bind, the node is a gap, never
  an older count.
- **Near a split:** a split within `SHARE_COUNT_SPLIT_WINDOW_DAYS` (7) of S, or after S and on or before D, is
  `incompatible_basis`. A split's shares are distributed days before its ex-date, the date a listing's splits carry,
  and a filing made after a split may state its count on either basis.
- **Several counts:** companyfacts lists undimensioned values only. A multi-class issuer tags one count per class, so
  it lists none: Alphabet, Meta, Snap and Under Armour have no values (checked 2026-10-21). A filing that does list two
  stores one as partial coverage with no context, and binding gaps with `incompatible_scope`. Some older filings of
  multi-class issuers list a single value, such as Berkshire Hathaway's 2009 to 2011 filings, one of them 0. The age
  rule keeps those out of a current plan, but not out of a historical one.
- **No restatement:** a later filing states a later date's count, never an earlier one's, so restatement detection
  compares us-gaap figures only.
- **In chat:** a market cap answer shows the count it read beside the figure (next sections). Chat's research scope
  still marks `shares_outstanding` unavailable, since no chat reader shows a count, so a follow-up does not re-read it.
  A 10-Q's count is stored only when that quarter is ingested.

## Share prices as engine inputs (#444)

A share price binds into a financial plan the way a fact does, but it is market data and never becomes a fact. It has
its own stored observation and its own bound-input variant. `market_cap` and `pe_ratio` read it (next section).

- **Stored as stated:** `npm run capture:price -- <listing_uuid>` (in `services/market`) records Polygon's unadjusted
  session closes of the last week and, when the key is entitled to snapshots, the last trade. Rows go to the
  insert-only `price_observations` table (migration 0069). `price_text` is Polygon's exact token, parsed losslessly,
  and `body_sha256` hashes the whole response. Capturing the same statement again is the same row: the key is the
  listing, source, kind, trade time, and token. A revised close is a new row, known later.
- **Known at the fetch:** a price is known when its response finished arriving, the earliest instant the fetch proves.
  Polygon states no delay to subtract. The adapter's `delay_class` is configuration (`services/market/src/stack.ts`),
  and the `status` field states no delay either. For the same bar and key it said `DELAYED` on the capture's range,
  which reaches into the current day, and `OK` on `/prev` and on a range that ends the day before. A last
  trade stamped after its response arrived has no known time, so it never binds, and when no other price is known by
  the cutoff the gap is `publication_time_unknown`. A session close
  is observed at 16:00 exchange time on its date, and a bar whose session had not closed is not captured.
- **Bound on the analysis's basis:** a `share_price` node takes the period `{ "kind": "at_cutoff" }` and binds a
  `BoundPriceInputV1` (`services/financial-core/src/contracts.ts`). It carries the observation id, the exact token
  beside its canonical value, the trade and known times, the listing, currency, source, and body hash. The token and the hash of the response it
  came in are its precision proof, as a fact's token and token proof hash are. Its
  `split_adjustment.v2` runs from the trade's date in the listing's zone to the reference date R: a price is on the
  split basis of its own trade date, so it is divided by the splits after that date and on or before R. Core checks
  the token against the value, the adjustment against its own splits and anchor, and that the price was known between
  its trade and the cutoff.
- **Selection** (`services/financial-engine/src/select-price.ts`, `price-at-cutoff-selection.v2`): the subject's one
  common-stock listing at the cutoff decides, as for EPS. Each source's observations with its newest trade time known
  by the cutoff are read. Only those whose class the run was granted are evidence, and they are filtered before the
  newest is picked, so a newer price from another source never hides an allowed one. Of those, the newest trade time
  binds, and among its observations the latest known. Gaps: `missing_input` (none known by then),
  `publication_time_unknown` (only ones without a known time), `source_class_not_allowed` (none from a granted
  class), `precision_unverified` (a token outside the numeric policy), `conflicting_evidence` (the latest prices
  disagree), and `stale_input`, then the split gaps of #387. A price is stale when it traded before the last regular session the cutoff has closed
  (`lastRegularSessionDate`, `services/market/src/ytd-window.ts`): weekdays, closing at 16:00 exchange time
  (`SESSION_CLOSE_MINUTES`). A Friday close is current until Monday's session closes.
- **Seal:** the snapshot verifier reloads the observation. A missing one fails the input
  (`price_observation_unavailable`), and so does one whose token, times, listing, response, or currency no longer
  match (`price_observation_changed`). The verifier resolves the subject's listing again (`listing_changed`) and
  rebuilds the restatement from that listing's current splits (`splits_changed`), as for EPS. It re-checks the price's
  class against the run's grant, as for every input (below). The seal cites the price's source.
- **Limits:** weekdays stand in for an exchange calendar, so until the session after a market holiday closes, the
  price before the holiday reads as stale.

## Market cap and P/E (#444)

Two operations read a share price (`services/financial-core/src/operations.ts`). `market_cap.v1` multiplies it by
shares outstanding, in the price's currency. `pe_ratio.v1` divides it by diluted EPS and is dimensionless, rounded
like every other division (`numeric-policy.v1`). `ratio` cannot express either: market cap is a product, and P/E
divides an instant price by a duration's EPS.

- **One reference date:** every operand is restated to its listing's reference date R. An operand records the
  listing and R it was restated to (`FinancialOperand.restated_to`). An operand that was never restated, such as a
  count stored before #387, gaps `incompatible_basis`. Two restatements of one subject on different listings or dates
  contradict its bindings, since a subject resolves to one listing per run, so they fail the unit's integrity
  (`split_reference_mismatch`). The selectors already bind the price and the count from the subject's one
  common-stock listing. The operation checks that they did.
- **Which EPS:** the latest fiscal year's diluted EPS. The earnings node must select `{ "kind": "latest", "period_type": "annual", "offset": 0 }`, or P/E gaps
  `unsupported_period`, so "P/E" always means the year that was latest at the cutoff. Trailing-twelve-month EPS
  cannot be expressed: `trailing_sum` adds only flows, and a fourth quarter's EPS is never derived. Basic EPS never
  stands in (`incompatible_definition`).
- **Gaps:** EPS of zero or less is `non_positive_denominator`, and a share count of zero or less `non_positive_base`.
  A price and EPS in different currencies are `incompatible_currency`: v1 converts no currency. An input's gap blocks
  the figures that read it (`blocked_by_dependency`), and its own output names the reason.
- **Planning:** a plan asks for both like any approved operation, and the model planner's prompt names each with the
  operands it reads (`financial-plan-prompt.v2`). The planner rejects a `share_price` node that is not the price of a
  valuation (`price_without_valuation`). An answer resting on a valuation always shows its price and its share count
  or EPS, as one resting on free cash flow shows its OCF and capex (`shownOperands`, `planner.ts`). They are
  published before the figure unless its unit already publishes them.
- **Surfaces:** grids offer `latest_market_cap` and `latest_pe_ratio`, labelled "P/E (latest FY diluted EPS)"
  (`services/analyst-grids/src/financial-column.ts`). Both are valued at the run's cutoff, so they take no period
  params. A cell lists its own figure first and its price and operand after it, so the cell shows the valuation and
  its sealed block carries the inputs. Chat routes a market cap or P/E question to the engine (`isFinancialRequest`),
  and its scope names `market_cap` and `pe_ratio`, so a follow-up reads them (`SCOPE_METRICS`). The answer shows the
  figure beside the inputs it read, and each one's inspector shows its date: the price's trade, the count's cover
  date, and the EPS's fiscal year. The screener shows them too (below).
- **Presentation:** a valuation is dated by its price ("latest known at the cutoff"), since its other operand is
  restated to the same R. P/E reads as a multiple, as an approved ratio does.
- **Seal:** the snapshot verifier recomputes both through the operation registry and checks each input as it does
  for any price or fact.

## Market cap and P/E in the screener (#444)

The screener shows the engine's certified figures and computes neither itself. Its universe is thousands of listings
and its search needs no sign-in, while an engine run belongs to a user and a parent and values at most 25 subjects. So
an operator command certifies the universe ahead of time, and each screen reads what it wrote.

- **Batch:** `npm run certify:screener-universe -- [--as-of <iso>]` in `services/dev-api`
  (`src/screener-certification.ts`) values every issuer with an active common-stock listing and a domicile, sector and
  industry, at now unless pinned. Issuers go 25 to an engine run, each under its own `screener_valuation_runs` row.
  One service user owns every such run (`00000000-0000-4000-8000-0000000005ee`, seeded by migration 0071), because
  `financial_runs.user_id` is required and these runs belong to no person. Runs plan from the grids' valuation plan
  (`services/financial-engine/src/valuation-plan.ts`), one unit per issuer and figure. Nothing schedules the batch,
  as nothing schedules `sync:splits` or `capture:price`, so run it after a session's prices are captured.
- **Read model:** the transaction that seals a figure, or the gap sealed instead, writes it to
  `screener_certified_valuations`, keyed by issuer and figure. A null keeps its root reason: a figure blocked by an
  input records the input's own reason, such as `split_listing_unresolved` for an issuer with two common-stock
  listings. A run that finishes late, a recovered one say, never replaces a figure certified at a later cutoff, and a
  gap never replaces a value in the value's own session, so a price that goes missing mid-session leaves the figure.
  A gap replaces a value once a later session closes, when the value would read as null anyway.
- **Screens:** a screen reads every candidate issuer's figures in one query (`loadCertifiedValuations`,
  `services/screener/src/db-candidates.ts`) and does no engine work. Every listing of an issuer shows the issuer's
  figure, so a second listing never counts the shares again. A row carries `market_cap_currency`, the currency the
  figure was priced in, and the web labels the market cap with it rather than with a secondary listing's quote.
- **Freshness:** a figure shows while it certifies the last regular session closed by now, in its listing's zone
  (`lastRegularSessionDate`). Once a later session closes it reads as null until the batch runs again, so the screener
  never shows a stale figure. If the batch stops running, every figure reads as null after the next close.
  `lastRegularSessionDate` skips weekends only, so on a market holiday every figure reads as null from the holiday's
  close until the batch certifies the next real close, about a day.
- **Retries:** rerunning a cutoff resumes its runs. They are created up front under an advisory lock, so two attempts
  never value an issuer twice, and the engine never publishes a unit twice. A run whose execution failed or was
  cancelled, an integrity failure in one issuer's inputs say, sealed nothing: the batch reports its issuers and exits
  1, and a rerun at the cutoff values them in new runs. They go 25 to a run again, so an issuer that fails every time
  takes its new run's other issuers with it. The supervised worker resumes an
  interrupted run (`screenerUniverseRecovery`, registered in `services/dev-api/src/runtime.ts`).
- **Erasure:** deleting a run's `screener_valuation_runs` row erases the run, and a figure goes with its certificate.
  Deleting a fact erases every run that bound it, so the other issuers in that run show null until the next batch.
- **Vendor path:** `SCREENER_CANDIDATE_SOURCE` picks the reported or the vendor repository once per process
  (`services/screener/src/dev.ts`), so a response never mixes certified and vendor figures. The vendor path is
  unchanged.
- **Limits:** each refresh adds a run per 25 issuers and a sealed snapshot per figure, and nothing prunes older
  refreshes yet. Coverage excludes an issuer with several common-stock listings, such as Alphabet's GOOGL and GOOG:
  its figures are `split_listing_unresolved` gaps. An issuer listed only through ADRs has no common-stock listing, so
  the batch never values it, and both read as null.

## Source classes at binding (#444)

Every runtime authority declares `allowed_source_classes`. Binding uses evidence only from those classes
(`services/financial-engine/src/select-inputs.ts`).

- **Class:** `sourceClassOf` (`services/financial-core/src/evidence-vocabulary.ts`) is a table of which sources ground
  which evidence. A fact is `sec_filing` when its source is a filing, since every filing this system ingests comes
  from EDGAR. A price is `market_data` only from an approved provider, Polygon's source (`POLYGON_MARKET_SOURCE_ID`).
  The Stooq, Yahoo and stock-screener feeds are `market_data` sources too, but they serve development, so their
  prices have no class. No other source has a class yet, so no authority admits an article, a press release, an
  upload, or a development feed. The approved providers live in the class mapping rather than in price selection
  because binding and the seal read the same mapping, so a provider outside it fails both.
- **Eligibility:** a candidate from a class the authority does not allow is ineligible, with the reason
  `source_class_not_allowed`. That reason is reported only when nothing closer to eligibility exists. A disallowed
  candidate never wins a tie, never raises a conflict, and never names a latest period. A share count still finds the
  newest filing among every filed count before eligibility, so a disallowed newest count gaps rather than letting an
  older one stand in. A not-yet-public candidate stays invisible, so its class leaks nothing about the future.
- **Prices:** each source's newest observations are read, and only allowed ones are evidence before the newest is
  picked. When none is allowed, the slot gaps `source_class_not_allowed`.
- **Grants:** chat and grids allow `sec_filing` and `market_data`. The operator approved figures derived from
  Polygon's prices there, since users bring their own key and data. The screener's certification batch allows both
  too. Analyze, Discovery and the thesis adapter allow `sec_filing` only.
- **Recorded grant:** a run records its authority's classes as a sorted set (`financial_runs.allowed_source_classes`,
  migration 0070), immutable like its plan. Binding uses that grant on every attempt, and the seal re-checks each bound
  input's class against it (`financial_input_ineligible`, `source_class_not_allowed`). A retry whose authority grants
  every recorded class resumes the run under the grant it recorded: a wider grant cannot change bindings already
  made, just as later evidence needs a new run. A retry that lacks a recorded class is a conflict
  (`source_classes_not_granted`), since the run's bindings may use it, and recovery skips such a run
  (`parent_withdrew`). Runs reserved before 0070 were granted `sec_filing`, the only class any surface allowed.

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

