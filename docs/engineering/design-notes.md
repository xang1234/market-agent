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
- **Narrative guard** (`narrative-guard.ts`): when fact blocks are shown, the model is given the displayed figures
  and told not to compute new ones. Any sentence whose numbers don't appear in the displayed figures or in a cited
  claim is dropped. If nothing survives, a fixed pointer to the figures is shown instead. Numbers are compared by
  value only, not unit (see the `ponytail:` note in the file).
- The displayed figures reach the model as rows (`displayedFigures`, `fact-blocks.ts`): `{company, metric, value}`
  for comparison cells, `{metric, value}` / `{metric, period, value}` for single-company blocks. A comparison figure
  must also be credited to its company, even when a claim repeats the number: every company named between the
  previous such figure (or the sentence start) and this one must own it; if none is named there, the first one named
  after it when a preposition ties them ("49.2% for AMD", not "49.2%, exceeding AMD"), which is then used up, else
  the company of the previous figure in the sentence, else the one company named by the last kept sentence naming
  any on the line (none if it named several: "NVDA trails AMD. Its..." is ambiguous). Naming another company in that
  stretch is ambiguous and drops the sentence, as does a "respectively" construction, so a real figure quoted for the
  wrong company never survives; the cost is some valid sentences dropped (tracked for tuning against the eval).
  Companies are recognized by their displayed label (ticker), case-sensitively, which the prompt tells the model to
  use; digits inside a label are not figures.
- A failure while building fact blocks degrades to a narrative-only answer; it never costs the user the answer.

## Which companies a chat turn covers

`resolveTurnSubjects` (`services/chat/src/coordinator.ts`) decides a turn's companies, primary first:

1. The **whole message** is resolved first, so a bare ticker, a company name, or a theme behaves as before.
2. Otherwise, **every ticker** the message mentions is resolved (`extractSubjectMentions`), de-duplicated by canonical
   issuer (two listings of one company count once), and capped at 5.
3. The **previous answer's companies** are prepended when the message names none ("explain the differences") or is
   comparative ("compare it with AMD", "vs", "against", "peers"). They come from the last assistant message's sealed
   snapshot `subject_refs`, re-hydrated via `hydrateSubjectRef` (`services/chat/src/thread-context.ts`). Naming a new
   company without comparing replaces them ("analyze AAPL and its margins").

The turn's fact blocks follow from that list:
- one company gets the metric row and revenue chart;
- two or more get a `metrics_comparison` of the latest fiscal year, via analyze's peer pipeline (key stats, then the
  materializer, then the builder);
- one company plus "peers" uses the industry peer set (`createSqlPeerSetResolver`).

A block that names its own subjects (a comparison's issuers) adds them to the snapshot's subject refs. The model also
sees the last 6 messages of the thread. The price-performance chart is tracked separately (#133).

## Sealed price series (`perf_comparison`)

A comparison of two or more listed companies also gets a price-performance chart (`services/chat/src/perf-block.ts`).
Each company's line comes from its latest stored daily bar range (`market_bar_ranges` / `market_bars`,
`split_and_div_adjusted`), normalized to percent return. The companies' windows must be identical, or there is no
chart.

- **Sealing:** every series has a `series_specs` entry in the snapshot manifest. The entry holds the `series_ref`, the
  bar range's `source_id`, `listing_id`, `bar_range_id`, interval, range and `as_of`. The block cites these through
  `data_ref.params.series_refs` and lists the sources in `source_refs`, which is what the verifier requires of
  `perf_comparison` (`requiresSealedDataSupport`).
- **The points travel in the block** (`series`, a schema addition along with `subject_labels`). The web draws a sealed
  block exactly as sealed, with no live `/v1/market/series` fetch and no range toggle, because only one window is
  sealed. Blocks without `series` keep the live behaviour. Other ranges for a sealed answer would need the ADR-0002
  transform/refresh flow.

