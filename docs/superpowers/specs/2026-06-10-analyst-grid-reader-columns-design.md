# Analyst Grid Reader Columns ("Question Columns") — v1 Design

Date: 2026-06-10
Status: Approved (design review in session)
Branch context: stacks on `feat/analyst-grid-run-engine`

## Problem

Analyst Grids currently support only deterministic fact-backed columns (one
implemented: `latest_market_cap`). The column catalog already declares a
`reader` column kind (`services/analyst-grids/src/column-catalog.ts`), cell
refs already allow `kind: "claim"` (`services/analyst-grids/src/types.ts:54`),
and cell statuses `missing_data` / `no_coverage` already model qualitative
gaps — but no reader column exists. This feature delivers the
AlphaSense-Generative-Grid-equivalent: a column defined by a free-form
research question, answered per row across the universe, with every cell
sealed and claim-backed so it click-throughs to the evidence inspector.

## Decisions made in review

- **Evidence path: run-time extraction.** Cells select recent documents for
  the subject via `mentions` and run reader-model extraction at run time,
  persisting new `claims` rows. (Alternatives — reuse-existing-claims-only and
  hybrid — rejected for v1: sparse claim coverage today / two code paths.)
- **Column UX: free-form question.** A single parameterized catalog entry;
  the prompt lives in `ColumnSpec.params`. (Curated templates deferred.)

## Design

### 1. Column definition

- New catalog entry `reader_question`, kind `reader`, in
  `services/analyst-grids/src/column-catalog.ts`.
- `ColumnSpec`: `{ column_key: "reader_question", params: { prompt: string, label?: string } }`
  (`params` already exists on `ColumnSpec`, `services/analyst-grids/src/types.ts:26`).
- Validation (grid create/update): prompt length 8–300 chars; at most 3
  reader columns per grid (cost bound). Violations raise `GridValidationError`
  (existing 400 path — no run row is created).
- `listColumns()` advertises the entry; column lookup becomes params-aware
  (`getColumn(columnKey)` still resolves the entry; the producer receives the
  per-column params via the run engine).
- Contract changes this requires (both currently lack a params/LLM path):
  - `GridColumnContext` gains `params: JsonValue | null` (the column's
    `ColumnSpec.params`), threaded through the run worker → cell runner →
    producer.
  - `GridColumnDeps` gains an optional `readerChannel` (reader LLM caller +
    tool-call logger); deterministic producers ignore it.

### 2. Producer pipeline (per cell)

1. **Subject gate**: `issuer` subjects only in v1. Other kinds → `no_coverage`.
2. **Document selection**: query `mentions` joined to `documents` for the
   subject — most recent ≤5 documents within a 180-day window, ranked by kind
   preference `filing > transcript > press_release > article`, excluding
   `ephemeral`-license sources (GDELT metadata-only) and honoring user-scoped
   document visibility. The resolved fiscal `PeriodContext` is advisory only
   (prefers "last quarter" docs when present); it is not load-bearing — this
   deliberately sidesteps the unimplemented Plan-3 document→issuer period
   linkage.
3. **Reader extraction**: one reader-channel LLM call over the selected
   documents' text, focused by the question. Output: question-relevant claims
   (persisted as real `claims` rows bound to their source documents) plus a
   ≤140-char cell answer composed only from those claims. Raw document text
   never leaves the reader path (invariant I4). Every call is logged via
   `writeToolCallLog` (`services/observability/src/tool-call-log.ts`) so the
   seal's tool-call audit passes.
4. **Outcomes**:
   - no eligible documents → `no_coverage`
   - documents but no relevant claims → `missing_data` with
     `coverageFlag: "no_relevant_claims"`
   - otherwise → `ok`, `display.value` = answer, `primaryRef = { kind: "claim", id: <top claim> }`

### 3. Sealing

- New helper `buildClaimBackedSealInput`, sibling of `buildFactBackedSealInput`
  (`services/analyze/src/block-seal-input.ts`).
- Block: registered kind `rich_text` carrying the answer text and claim
  citations.
- Manifest: `claim_refs` + `document_refs` + `source_ids` + `tool_call_ids`
  + `tool_call_result_hashes`, `subject_refs` for the row subject.
- Goes through the **normal** tool-call provenance audit. Explicitly NOT the
  `DETERMINISTIC_SNAPSHOT_MANIFEST` exemption — that is reserved for pure
  DB-fact cells (see persistent memory note
  `analyst-grid-deterministic-seal-provenance`).
- Cell click-through to the evidence inspector works unchanged via the
  sealed `snapshot_id` (existing cell-runner behavior,
  `services/analyst-grids/src/cell-runner.ts`).

### 4. LLM access

- A `reader` channel through the existing `services/llm` router/channel
  config. The grid run worker calls it directly. No new model plumbing.

### 5. UI

- GridBuilder: "Add question column" control with a prompt text field
  (uncontrolled FormData form, consistent with the current GridBuilder).
- Cell render: answer text; existing inspector click-through; `no_coverage` /
  `missing_data` render honestly (no fabricated cells).
- Run progress: existing polling; reader cells simply take longer.

### 6. Deferred (follow-up beads, not v1)

- Cross-run result caching keyed on (subject, prompt-hash, latest-doc
  watermark).
- Curated question templates.
- listing→issuer mapping so listing rows can answer issuer questions.
- Cross-run grid diffing ("what changed since last run").

### 7. Testing / acceptance

- Producer unit tests with a fake reader channel + fixture documents:
  `ok`, `no_coverage`, `missing_data`/`no_relevant_claims`, and error paths.
- Seal test: claim-backed manifest passes `snapshot-verifier` (claims,
  documents, sources, tool calls all bound).
- Validation tests: prompt length rules, reader-column count cap.
- End-to-end: a 3-row manual universe × 1 question column run completes with
  sealed, inspector-traceable cells.
- Acceptance: a 10-row grid with one question column completes with sealed,
  claim-backed cells and honest `no_coverage` statuses where evidence is
  absent.
