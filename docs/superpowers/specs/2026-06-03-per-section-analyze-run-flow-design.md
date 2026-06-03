# Per-Section Analyze Run Flow Design (fra-tx2o)

**Status:** Approved (design phase)
**Bead:** fra-tx2o — "Build a per-section analyze run flow (host for deterministic block emitters)"
**Unblocks:** fra-xa3g (wire emitPeerComparisonBlock), and the fra-6syg stub-block renderers once their producers exist.
**Date:** 2026-06-03

## Problem

The deterministic peer-comparison producer `emitPeerComparisonBlock` (`services/analyze/src/metrics-comparison-emitter.ts`) is built and proven end-to-end, but **nothing hosts it**. The analyze run (`POST /v1/analyze/runs` → `createRun` in `services/dev-api/src/http.ts` → `runAnalyzeWorkflow` in `services/dev-api/src/local-runtime.ts`) emits a **single narrative memo block** and seals with `fact_refs: []`. It never walks the playbook's sections, so the `peer_table` section never runs its producer — and the `metrics_comparison` renderer (shipped PR #66) renders em-dashes for lack of data. `template-runner.ts` is pure persistence (caller supplies blocks + a `sealSnapshot()` callback). There is no section→producer mapping anywhere.

## Goal

A per-section run flow that walks a resolved playbook's sections, dispatches each section with a registered deterministic producer, merges the producers' output with the existing narrative memo into one sealed snapshot — so the `peer_table` section emits a real `metrics_comparison` block. Adding a future producer becomes a one-line registry entry.

## Decisions (locked)

1. **Deterministic producers + keep the memo.** v1 dispatches only sections that have a registered deterministic producer (`peer_table` → `emitPeerComparisonBlock`). All narrative sections stay folded into the existing single memo block. No per-section LLM narrative engine.
2. **Materialize on pool, then seal/persist.** The emitter writes its derived facts via the pool (they commit immediately; the materializer is idempotent on-conflict). Merge → seal → persist run as separate transactions, matching today's `...WithPool` flow. A run that fails after materializing leaves harmless orphan derived facts (acceptable for v1).

Rejected: full per-section narrative engine (LLM-per-section — much larger, not needed to light up `peer_table`); single atomic run transaction (more plumbing; orphan derived facts are benign).

## Background (verified)

- `emitPeerComparisonBlock(deps, input): Promise<SnapshotSealInput | null>` where `deps = { db: QueryExecutor, peers: PeerSetResolver, stats: StatsRepository, clock? }` and `input = { primary: IssuerSubjectRef, snapshotId: UUID, blockId: string, asOf: string, peerLimit?, title? }`. Returns a **complete `SnapshotSealInput`** (manifest with populated `fact_refs`, the finalized `metrics_comparison` block, the `facts` rows, and `sources`) — or `null` when there are no peers / no materialized metric facts. As a side effect it writes derived metric facts to `deps.db`.
- Playbooks (`services/analyze/src/playbook.ts`): three — `earnings_quality`, `variant_view`, `peer_comparison`. Each `AnalyzePlaybookSection` is `{ section_id, title, required, block_hint }`. Only `peer_comparison`'s `peer_table` section has a deterministic producer today.
- `SnapshotSealInput` (`services/snapshot/src/snapshot-sealer.ts`): `Omit<SnapshotVerificationInput,"manifest"> & { manifest: SnapshotManifestDraft }` — i.e. `{ snapshot_id, manifest, blocks, facts, sources }`. The manifest carries `subject_refs, fact_refs, claim_refs, document_refs, source_ids, tool_call_ids, as_of, basis, normalization, model_version, …`.
- Sealing: `sealSnapshotWithPool(pool, input)` (own transaction) and `sealSnapshotInTransaction(db, input)` (caller's tx). The verifier checks the block's `data_ref.params.fact_bindings` against the **provided** `facts` array — so the seal does not re-read the materialized facts from the DB.
- Today's memo seal (`sealAnalyzeSnapshot`, `local-runtime.ts`) stages a manifest via `manifestFromBlockRefs` (collects `claim_refs`/`document_refs`/`source_ids`/`tool_call_ids` from blocks; `fact_refs: []`).
- `persistAnalyzeTemplateRunAfterSnapshotSealWithPool(pool, { template_id, template_version, blocks, playbook_id?, run_metadata, sealSnapshot })` calls the seal callback, then persists the run row in its own transaction.

## Architecture

Two new units in `services/analyze/` (it owns the playbook + emitter) plus thin wiring in dev-api (it owns the pool / transaction / HTTP trigger). The narrative memo path is unchanged except it now yields a `SnapshotSealInput` for uniform merging.

```text
services/analyze/src/
  section-producers.ts   (NEW) producer registry: (playbook_id, section_id) → SectionProducer
  section-runner.ts      (NEW) runDeterministicSections(...) + mergeSealInputs(...) [pure]
services/dev-api/src/
  local-runtime.ts       (mod) memo path yields a SnapshotSealInput; run deterministic sections; merge; seal merged
```

### Unit 1 — producer registry (`section-producers.ts`)

A pure lookup, keyed by `"${playbook_id}:${section_id}"`:

```ts
export type SectionProducerDeps = {
  db: QueryExecutor;
  peers: PeerSetResolver;
  stats: StatsRepository;
  clock?: () => Date;
};
export type SectionProducerContext = {
  primary: IssuerSubjectRef;
  snapshotId: UUID;
  asOf: string;
};
export type SectionProducer = (
  deps: SectionProducerDeps,
  ctx: SectionProducerContext,
) => Promise<SnapshotSealInput | null>;

export function lookupSectionProducer(playbookId: string, sectionId: string): SectionProducer | undefined;
```

The `peer_comparison:peer_table` entry invokes `emitPeerComparisonBlock(deps, { primary: ctx.primary, snapshotId: ctx.snapshotId, blockId: sectionBlockId("peer_table"), asOf: ctx.asOf })`. `sectionBlockId(sectionId)` produces a stable per-section block id (e.g. `` `${sectionId}-1` ``). Sections absent from the map have no deterministic producer and are covered by the narrative memo.

### Unit 2 — runner + merge (`section-runner.ts`)

```ts
export async function runDeterministicSections(
  deps: SectionProducerDeps,
  input: { playbook: AnalyzePlaybook; primary: IssuerSubjectRef | null; snapshotId: UUID; asOf: string },
): Promise<ReadonlyArray<SnapshotSealInput>>;

export function mergeSealInputs(
  base: SnapshotSealInput,
  sections: ReadonlyArray<SnapshotSealInput>,
): SnapshotSealInput;
```

- `runDeterministicSections` walks `input.playbook.sections`; for each section with a registered producer it builds the `SectionProducerContext` and invokes the producer, collecting non-null results in section order. When `input.primary` is `null`, producers that require an issuer `primary` (i.e. `peer_table`) are skipped without invocation. A producer returning `null` is skipped; a producer that throws propagates (fails the run).
- `mergeSealInputs` is **pure**: it returns one `SnapshotSealInput` whose `blocks` and `facts` are `base` followed by each section's, whose manifest **unions** `subject_refs`, `fact_refs`, `claim_refs`, `document_refs`, `source_ids`, `tool_call_ids` (de-duplicated), whose `as_of` is the max across inputs, whose `sources` unions all `sources`, and whose scalar manifest fields (`basis`, `normalization`, `model_version`, `snapshot_id`, …) are taken from `base`. It asserts each section shares `base.snapshot_id`.

### dev-api wiring (`local-runtime.ts`)

The memo path is refactored so it produces a `SnapshotSealInput` (`buildMemoSealInput` — the existing `manifestFromBlockRefs` logic, returning a full seal input with `fact_refs: []` rather than staging a manifest at seal time). `createRun`/the analyze adapter then:

```text
resolve playbook
memoSeal   = buildMemoSealInput(memo block, …)
sectionSeals = await runDeterministicSections({ db: pool, peers, stats, clock }, { playbook, primary, snapshotId, asOf })
merged     = mergeSealInputs(memoSeal, sectionSeals)
persistAnalyzeTemplateRunAfterSnapshotSealWithPool(pool, {
  template_id, template_version, playbook_id, run_metadata,
  blocks: merged.blocks,
  sealSnapshot: () => sealSnapshotWithPool(pool, merged),
})
```

`peers`/`stats`/`primary` come from the run's resolved subject + the analyze service's existing repositories (`createSqlPeerSetResolver`, the stats repository). The `peer_table` producer needs an **issuer** `primary`; when the run's subject does not resolve to an issuer ref, `runDeterministicSections` receives no issuer `primary` and the peer producer is skipped (treated as `null`). When the playbook has no deterministic sections, `sectionSeals` is empty and `merged` equals the memo-only seal — behavior is identical to today.

## Error handling

- Section producer returns `null` (no peers / no facts) → section omitted; run proceeds with the memo (and any other sections).
- Section producer throws (DB/resolver error) → propagates; the run fails loudly rather than silently shipping a run missing its peer table.
- `mergeSealInputs` asserts shared `snapshot_id` and is total/pure — no partial state.
- Derived facts commit on the pool before sealing; seal verification uses the `facts` array carried in the merged seal input, so it does not depend on a fresh DB read.

## Testing

- **Registry** (`services/analyze/test/section-producers.test.ts`): `lookupSectionProducer("peer_comparison","peer_table")` is defined; narrative section ids and unknown playbooks return `undefined`.
- **`mergeSealInputs`** (pure unit, `services/analyze/test/section-runner.test.ts`): memo base + one emitter-shaped seal → unions `fact_refs`/`claim_refs`/`source_ids`, concatenates `blocks` + `facts`, `as_of` = max, de-dups refs; empty `sections` → equals base; two sections → all merged; mismatched `snapshot_id` → throws.
- **`runDeterministicSections`** (`services/analyze/test/section-runner.test.ts`): the real emitter against a fake `QueryExecutor` (mirroring `metrics-comparison-emitter.test.ts`) with the `peer_comparison` playbook → returns one seal input whose block kind is `metrics_comparison`; a playbook with no deterministic sections → `[]`.
- **dev-api run path** (extend the existing analyze-run test): a `peer_comparison` run produces combined blocks (the memo `rich_text` + a `metrics_comparison`) and the merged seal **verifies** with non-empty `fact_refs`.

## Out of scope (YAGNI)

Per-section LLM narrative blocks; a single atomic run transaction (materialize-on-pool chosen); the `fra-6syg` stub-block producers (each becomes a future registry entry); section placement/ordering refinement (deterministic blocks append after the memo); new playbooks.

## Acceptance

A `peer_comparison` analyze run, triggered through the existing `/v1/analyze/runs` path, walks the playbook, runs the `peer_table` producer, merges its block + `fact_refs` with the narrative memo, and seals one snapshot whose `metrics_comparison` block carries real fact bindings — verified by the snapshot verifier. Adding another deterministic producer requires only a registry entry. Covered by registry, merge, runner, and run-path tests.
