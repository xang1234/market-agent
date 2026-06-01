# Design: `metrics_comparison` block emitter (fra-bk83)

## Context

PR #66 (`fra-0clw`) shipped the **contract + renderer + fixture** for the
`metrics_comparison` block: it now carries a `cells` matrix
(`{ value_ref, format?, tone? }` indexed `[subjectIndex][metricIndex]`) and a
`primary_subject_ref`, and the renderer shows mono values, tone coloring, and a
highlighted primary row. But **nothing emits this block** — it exists only in
web fixtures. This design covers building the server-side producer.

The hard part is **not** the UI. It is that every cell `value_ref` must resolve
to a real **fact** in a **sealed snapshot** (the verifier enforces this). Today:

- **No block-emission pattern exists to copy.** No service turns data into any
  typed block (`metric_row`, `analyst_consensus`, …); blocks live only in
  fixtures. The fact/snapshot **sealing** pipeline is live and robust
  (`services/snapshot/`), but nothing upstream materializes facts + builds a
  block + seals them.
- **Key stats are computed ratios, not facts.** `services/fundamentals/src/key-stats.ts`
  computes `gross_margin = gross_profit / revenue` etc. via `computeRatio`; the
  *input* statement lines have `fact_id`s, but the derived ratio does not. So a
  cell value like "46.2% margin" has **no existing fact_id** — it must be
  materialized as a derived fact.
- **Fundamentals data is queryable + live**: `key-stats.ts`, `analyst-consensus.ts`,
  statements, quotes — all attached to `source_id` + `as_of`.
- **Peer selection** exists only as an unwired `get_peer_set` tool; `issuers`
  has `sector`/`industry`; `theme_memberships` could model cohorts. No
  precomputed peer set, no peer→block wiring.

## Decisions

**Locked:**
- **Tone = per-metric direction registry.** A `METRIC_DIRECTION` map declares
  which way is "good" per metric (margins/growth/EPS: higher = positive;
  valuation like P/E: lower = positive; leverage: higher = negative). Within a
  metric column, the best valid value → `positive`, worst → `negative`, others
  → `neutral`. A metric with <2 comparable values gets no tone. v1 directions
  (signed off): Revenue = none; gross/net margin, rev-growth, EPS = higher
  positive; P/E (fwd) = lower positive.

**Signed off (2026-06-01):**
- **Trigger / surface:** the **analyze `peer_comparison` playbook**
  (`services/analyze/src/playbook.ts` already declares a `peer_table` section).
  A deterministic emitter produces the `metrics_comparison` block for that
  section during a template run, rather than LLM-generating it.
- **Peer selection (v1):** deterministic — primary = the analyzed subject;
  peers = top *N=5* issuers in the same **`industry`** by market cap.
  `get_peer_set` integration is a follow-up. Keep peer selection behind a small
  interface so it can be swapped.
- **Metrics (v1):** reuse `key-stats.ts` — Revenue (TTM), Gross margin,
  Net margin, Rev growth YoY, P/E (fwd). Start narrow; widen later.
- **Period alignment:** use each issuer's latest comparable period from
  key-stats (TTM / latest FY). Record `as_of` per fact. If a peer lacks a
  metric for the aligned period → leave that cell **absent** (renders `—`); do
  **not** drop the peer. Surface coverage gaps via existing key-stats warnings.
- **Fact materialization:** for each cell, materialize a **derived fact**
  (`method='derived'`, `value_num`, `unit`, `as_of`, `source_id`, linked to its
  input fact_ids per the key-stats `inputs`) and use its `fact_id` as the cell
  `value_ref`. Reuse existing facts where a metric *is* already a stored fact.
- **Snapshot scope:** one snapshot **per analyze run**, bundling all blocks +
  fact_refs for that run (not per-block).

## Architecture / data flow

```
analyze peer_comparison run
  → peerSetResolver(primary, {criteria:'industry', n:5})    → issuer_ids[]
  → metricFetcher(issuer_ids, METRICS)                       → per-issuer KeyStat values (+ input fact_ids)
  → factMaterializer(values)                                 → derived fact_id per (issuer, metric)
  → blockBuilder(subjects, metrics, facts, primary)          → MetricsComparisonBlock
        · cells[s][m] = { value_ref: fact_id, format, tone }
        · tone via METRIC_DIRECTION + column extremes
  → snapshot manifest draft (fact_refs ∪ subject_refs ∪ source_ids) → sealSnapshot()
  → persist block(s) on the analyze_template_run
```

## Files to create / touch

- **New:** `services/analyze/src/metrics-comparison-emitter.ts` (peer resolve →
  fetch → materialize → build), `metric-direction.ts` (the tone registry +
  format hints), tests.
- **`services/fundamentals/`**: a peer-set resolver + a thin "fetch metric for
  issuer" reuse of `key-stats.ts`.
- **Fact materialization:** wherever derived facts are written (confirm the
  insert path / `facts` repository).
- **`services/snapshot/src/snapshot-verifier.ts`** (the wiring deferred from
  fra-0clw): `normalizeBlock` must pass through `subjects`/`metrics`/`cells`/
  `primary_subject_ref` (it currently drops `metrics`), and `extractBlockRefs`
  must extract each `cell.value_ref` as a fact — **kept aligned with**
  `web/src/evidence/inspectableRefs.ts` per its comment.
- **Web:** add the `metrics_comparison` case to `inspectableRefs.ts` and wrap
  `MetricsComparison` cells in `InspectableRef` (now that facts exist — the
  renderer comment documents this deferral).
- **`services/analyze/src/template-runner.ts` / `playbook.ts`:** invoke the
  emitter for the `peer_table` section.

## Decisions resolved (signed off 2026-06-01)

1. **Trigger surface** → analyze `peer_comparison` playbook (`peer_table` section).
2. **`METRIC_DIRECTION` table** → approved as proposed (Revenue = no tone;
   margins / growth / EPS higher = positive; P/E lower = positive).
3. **Peer criteria + N** → same **`industry`**, top 5 by market cap.
4. **Derived-fact lineage** → materialize derived facts (`method='derived'`)
   **with** input `fact_id` lineage, so a cell traces back to its components.

## Spike findings — derived-fact materialization path (fra-36y8, 2026-06-01)

Investigated `facts` schema (`spec/finance_research_db_schema.sql:548`), the canonical
write path (`services/evidence/src/fact-repo.ts`), the fundamentals fact path
(`services/fundamentals/src/sec-facts-repository.ts`), and the key-stats input
shape (`services/fundamentals/src/key-stats.ts`). Conclusions:

1. **Write path = `createFact()`** (`services/evidence/src/fact-repo.ts:307`). It
   already accepts `method:'derived'` (the `fact_method` enum includes `derived`),
   `value_num`, `unit`, `as_of`, `source_id`, `verification_status`, etc. **No new
   write primitive is needed.** The materializer (fra-wcj6) must call this, **not**
   add a raw insert. ⚠️ Drift to avoid: `sec-facts-repository.ts::persistStatementFacts`
   (line 477) bypasses `createFact` with its own `insert into facts … 'reported'`.
   Don't add a third insert path.

2. **No first-class lineage column.** `facts.supersedes`/`superseded_by` is
   *versioning* lineage only (same-identity supersession, guarded by
   `assertFactIdentityMatches`), **not** derivation-input lineage. `createFact`'s
   only lineage option is `{ supersedes }`. So decision #4's "link to input fact_ids"
   has two implementations:
   - **(A) — recommended for v1:** store lineage in `quality_flags` as a structured
     provenance entry, e.g.
     `{ kind: 'derivation', expression: 'gross_profit/revenue', inputs: [{ role, fact_id }] }`.
     Zero migration; reuses the existing `reviewProvenanceFlag` precedent
     (`fact-repo.ts:934`); verifier-safe (lineage lives on the *fact*, not the
     block, so `extractBlockRefs`/`inspectableRefs` never try to resolve it). The
     snapshot seal does **not** integrity-check these input fact_ids — lineage is
     "soft" (traceable, not enforced).
   - **(B) — follow-up if lineage must be queried/enforced:** a `fact_lineage`
     join table (`derived_fact_id` FK, `input_fact_id` FK, `role`, `expression`)
     written atomically alongside the derived fact. First-class + FK integrity,
     but a migration + a transactional `createFact` variant. Defer unless a
     consumer needs to query "what derives from fact X".

3. **Input fact_ids are recoverable but not surfaced.** Statement lines *are*
   persisted as `reported` facts (`persistStatementFacts`), but
   `KeyStat.inputs` keeps the `fact_id` only for `MarketFactInputRef` (price);
   `StatementLineInputRef` carries `metric_id`+`source_id`+period but **no
   `fact_id`** (`lineFromFactRow`, `sec-facts-repository.ts:457`, discards the
   `f.fact_id` the query already selects). Resolution for the fetcher (fra-nta8):
   thread `fact_id` through the load-from-facts path — add an optional `fact_id?`
   to `StatementLine`/`MappedStatementLine`, populate it in `lineFromFactRow`, and
   copy it onto `StatementLineInputRef`. `fact_id` is inherently optional on a
   statement line (absent on the freshly-fetched-not-yet-persisted path), but the
   emitter reads already-persisted peer facts, so it will be present there.

**Net:** decision #4 is buildable with **no schema migration** — `createFact(method:'derived')`
+ lineage in `quality_flags` (option A) + surfacing `fact_id` on the statement-line
input ref. fra-36y8 is therefore unblocking fra-wcj6 (materializer) and informs
fra-nta8 (fetcher).

## Verification strategy

- Unit: `metric-direction` (tone selection incl. ties / <2 valid), peer
  resolver, block builder (cell shape, format, tone), fact materializer.
- Integration: emit → seal → `verifySnapshotSeal` passes (every `value_ref`
  resolves); web `BlockValidator` accepts the emitted block; render test (reuse
  the fra-0clw renderer test against an emitted block, not just the fixture).
- Schema sync test stays green (no schema change needed — contract already
  shipped).

## Bead breakdown (dependency-ordered)

1. **Spike: derived-fact materialization path** — confirm how/where derived
   facts are written + lineage to input fact_ids. (Unblocks 4, 5.)
2. **`metric-direction` registry + format hints** — pure, fully unit-testable;
   no deps. (Authors the tone table for review.)
3. **Peer-set resolver** — sector + market-cap top-N, behind an interface.
4. **Metric fetcher** — per-issuer metric values via key-stats (+ input refs).
5. **Fact materializer** — derived fact per (issuer, metric). Deps: 1, 4.
6. **Block builder** — assemble `MetricsComparisonBlock` (cells/format/tone/
   primary). Deps: 2, 4, 5.
7. **Snapshot sealing integration** — manifest draft + `sealSnapshot`. Dep: 6.
8. **snapshot-verifier wiring** (`normalizeBlock` + `extractBlockRefs`) +
   web `inspectableRefs` + `InspectableRef` cells. Dep: 6.
9. **Trigger integration** — wire emitter into the analyze `peer_comparison`
   `peer_table` section. Deps: 7, 8.
10. **End-to-end test + emitted-block fixture** — emit→seal→verify→render. Dep: 9.
