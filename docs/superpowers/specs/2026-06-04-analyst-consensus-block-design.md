# Analyst-Consensus Block (fra-6syg, scoped) — Design

**Bead:** `fra-6syg` (scoped to `analyst_consensus`). Consumes `fra-tcav`'s
`AnalystConsensusEnvelope`; builds on the revenue_bars shared core
(`buildFactBackedSealInput`). `price_target_range` is split out to a new bead.

**Goal:** Turn the `AnalystConsensusEnvelope` into a sealed, verifier-valid
`analyst_consensus` block that renders a real rating distribution — mirroring the
revenue_bars / peer_table deterministic pipeline.

**Tech stack:** Node `--experimental-strip-types` (`services/analyze`,
`services/evidence`, `services/snapshot`), Postgres `facts`/`metrics`, React 19 web.

---

## Scope

- **In:** `analyst_consensus` end-to-end — `analyst_count` + the 5 rating-bucket
  counts (strong_buy/buy/hold/sell/strong_sell) materialized as vendor facts,
  bound into the block, rendered as an inline stacked bar.
- **Out (new bead):** `price_target_range`. It is genuinely blocked: its schema
  requires `current_price_ref`, but quotes are not persisted as facts anywhere
  (the market/quote service only caches). A follow-up bead will add a current-price
  fact source and the price_target_range emitter.

---

## Why these decisions

- **Display field needed (like revenue_bars).** The `analyst_consensus` block
  carries only refs (`analyst_count_ref`, `distribution[].count_ref`), and the web
  has no ref→value resolver. So each distribution bucket gains an optional
  **`count: integer`** display field; the web draws bar widths + count labels from
  it, while `count_ref` stays the provenance binding.
- **Mint, don't reuse.** Unlike revenue_bars (which reuses existing SEC facts),
  consensus values arrive in an envelope, so the emitter **materializes** vendor
  facts (like peer_table materializes derived facts). `createFact` returns the row,
  so no separate load query is needed.
- **No new web primitive.** Inline the stacked-bar render, mirroring the existing
  `web/src/symbol/consensusViews.tsx:RatingDistributionBar` (the `StackedBar`/
  `RangeSlider` primitives the original bead referenced do not exist).
- **Reuse the shared seal core.** `buildAnalystConsensusSealInput` delegates to
  `buildFactBackedSealInput` (from the revenue_bars work). The verifier already
  handles `analyst_consensus` (no verifier changes).

---

## Architecture & data flow

```
runDeterministicSections (existing)
  └─ earnings_quality:analyst_overview → ANALYST_CONSENSUS_PRODUCER
       └─ emitAnalystConsensusBlock({ db, consensus, clock }, ctx)
            1. envelope = await consensus.find(ctx.primary.id)
                 if envelope === null || envelope.rating_distribution === null → return null
            2. materialized = await materializeConsensusFacts(db, {
                 issuer: ctx.primary, envelope, clock })
                 // mints analyst_count fact + 5 rating-count facts via createFact:
                 //   method='vendor', period_kind='point', period_end = as_of date,
                 //   source_id = envelope.rating_distribution.source_id, unit='count',
                 //   verification_status/freshness_class chosen to pass the verifier
                 // returns { analystCount: {fact_id, count}, buckets: [{bucket,label,fact_id,count}], factRows }
            3. block = buildAnalystConsensusBlock({ materialized, base, coverage_warning })
            4. return buildAnalystConsensusSealInput({ block, facts: materialized.factRows,
                 primary: ctx.primary })
```

`SectionProducerDeps` gains `consensus: ConsensusRepository`. The dev-api analyze
run path provides it with the same wiring as fundamentals
(`devProviderRuntime?.consensus ?? createUnsupportedConsensusRepository()`), so when
the sidecar is off, `find()` → null → the section is simply omitted.

**Vendor fact fields** (per minted fact): `subject_kind='issuer'`,
`period_kind='point'`, `period_end` = envelope `as_of` date (YYYY-MM-DD),
`fiscal_year/fiscal_period` = null, `value_num` = the count, `unit='count'`,
`method='vendor'`, `source_id` = the rating distribution's `source_id`,
`coverage_level='full'`, `confidence=1`, `verification_status='authoritative'`
(same as peer_table's minted facts, which the seal accepts), `freshness_class='eod'`
(analyst data is daily-ish). The emitter test asserts `verifySnapshotSeal(...).ok===true`,
which confirms these choices.

**Seal bindings:** `point` facts require a binding on `unit`, `period_kind`,
`period_end` — all present on the minted rows, which `createFact` returns. The
manifest `fact_refs` = `[analyst_count_ref, ...count_refs]`; `subject_refs` =
`[issuer]`.

---

## Schema (one addition)

`spec/finance_research_block_schema.json` — on the `AnalystConsensus` distribution
bucket (currently `{ bucket, count_ref }`, `additionalProperties:false`) add
optional `count` (integer, minimum 0). Regenerate `web/src/blocks/blockSchema.json`
via `cd web && npm run sync:schema`. No block-level total field — the web header
shows `sum(counts)`.

---

## Files

**Create (4, `services/analyze/src`):**
- `analyst-consensus-materializer.ts` — `materializeConsensusFacts(db, input)`:
  resolves the 6 metric_ids by key, mints the facts via `createFact`, returns the
  refs + counts + the created `FactRow`s.
- `analyst-consensus-block-builder.ts` — pure `buildAnalystConsensusBlock(...)` →
  `AnalystConsensusBlock` with `analyst_count_ref`, `distribution[{bucket, count_ref,
  count}]`, optional `coverage_warning`, `data_ref.kind='analyst_consensus'`.
- `analyst-consensus-snapshot.ts` — `buildAnalystConsensusSealInput({block, facts,
  primary})` delegating to `buildFactBackedSealInput` (factRefs = analyst_count_ref +
  bucket count_refs; subjectRefs = [primary]).
- `analyst-consensus-emitter.ts` — orchestration; returns `SnapshotSealInput | null`.

**Modify:**
- `spec/finance_research_block_schema.json` + `web/src/blocks/blockSchema.json`.
- `services/analyze/src/section-producers.ts` — `ANALYST_CONSENSUS_PRODUCER` +
  registry key `earnings_quality:analyst_overview`; add `consensus` to
  `SectionProducerDeps`.
- `services/analyze/src/section-runner.ts` — pass `consensus` through (it already
  forwards `deps`).
- `services/analyze/src/playbook.ts` — add
  `section("analyst_overview", "Analyst overview", false, "section")` to
  `earnings_quality`.
- dev-api analyze run wiring (`services/dev-api/src/local-runtime.ts` /
  `runtime.ts` / `http.ts` as needed) — build + thread the `consensus` repository
  into the section-producer deps.
- `db/seed/metrics.sql` — 6 analyst metric rows.
- `web/src/blocks/AnalystConsensus.tsx` + `types.ts` (bucket gains `count?: number`) +
  `fixtures.ts` (add counts).

---

## Metrics seed

Add to `db/seed/metrics.sql` (idempotent `on conflict (metric_key) do nothing`):

```
analyst_count                — Analyst Count          — count    — point_in_time — neutral — vendor
analyst_rating_strong_buy    — Strong Buy             — count    — point_in_time — neutral — vendor
analyst_rating_buy           — Buy                    — count    — point_in_time — neutral — vendor
analyst_rating_hold          — Hold                   — count    — point_in_time — neutral — vendor
analyst_rating_sell          — Sell                   — count    — point_in_time — neutral — vendor
analyst_rating_strong_sell   — Strong Sell            — count    — point_in_time — neutral — vendor
```

`metric_id`s are `gen_random_uuid()`; the materializer resolves by `metric_key` at
runtime (tests use a fake db that maps keys → ids).

---

## Web rendering

`AnalystConsensus.tsx` renders an inline stacked horizontal bar (proportional widths
from each bucket's `count`, colored segments, count labels + a `sum(counts)` total),
mirroring `consensusViews.tsx:RatingDistributionBar`. Falls back to the existing
em-dash stub when `count` is absent (older sealed blocks). `coverage_warning` renders
as the existing alert line.

---

## Error handling / degradation

- `consensus.find()` null, or `rating_distribution` null → emitter returns `null` →
  section omitted (graceful; same as revenue_bars/peer_table with no data).
- `coverage_warning` on the block is set from the envelope's `coverage_warnings`
  (first message) when present.
- New fields optional → older sealed blocks still render via the stub fallback.

---

## Testing

- `analyst-consensus-materializer.test.ts` — fake db captures `createFact` inserts;
  asserts 6 facts minted with the right metric_ids/values/source_id, refs returned.
- `analyst-consensus-block-builder.test.ts` — pure: bucket order + labels, `count`
  per bucket, `data_ref.kind`, coverage_warning passthrough.
- `analyst-consensus-snapshot.test.ts` — fact_refs + bindings + subject_refs.
- `analyst-consensus-emitter.test.ts` — fake `ConsensusRepository` + fake db →
  block + `verifySnapshotSeal(...).ok === true`; null-envelope and null-distribution
  paths → null.
- `section-producers.test.ts` — `earnings_quality:analyst_overview` resolves.
- web `AnalystConsensus.test.tsx` — renders widths/counts from the fixture;
  `validateBlock(fixture).valid === true` with `count`; stub fallback.
- `db/seed` drift / metrics presence check if one exists; otherwise the emitter
  test's fake-db key→id map covers resolution.

---

## Deferred bead (filed during execution)

- `price_target_range` emitter — **blocked on** a new "persist current-price facts
  (quote→fact)" bead. Both filed; `fra-6syg` stays open until `analyst_consensus`
  ships, then the price work tracks separately.

---

## Acceptance

- `emitAnalystConsensusBlock` returns a verifier-valid `SnapshotSealInput` with
  `manifest.fact_refs` = the 6 minted fact_ids and a fact_binding per ref; null when
  no envelope/distribution.
- The block renders a real stacked rating distribution in the web with counts; the
  fixture validates against the schema with `count`.
- `earnings_quality` runs emit the `analyst_consensus` block when consensus data is
  available, omit it otherwise.
