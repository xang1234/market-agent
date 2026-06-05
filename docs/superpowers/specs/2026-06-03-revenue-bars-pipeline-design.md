# Revenue Bars Pipeline — Design

**Beads:** `fra-ef24` (this work) · child of `fra-6syg` · sibling blocker `fra-tcav`

**Goal:** Make the `revenue_bars` block render real quarterly revenue heights and labels
from sealed, verifier-valid facts — the first of the three stub blocks to get a genuine
data pipeline, mirroring `peer_table` (the `fra-tx2o` section-run flow) but simpler.

**Architecture:** A deterministic section producer (registered as
`earnings_quality:revenue_trend`) loads the last 8 quarterly revenue facts for the run's
primary issuer, computes a normalized magnitude and a compact-currency display label per
bar, builds a `revenue_bars` block, and returns a `SnapshotSealInput` that the existing
run flow merges and seals. No materializer is needed: each bar reuses an existing
`method='reported'` revenue fact.

**Tech stack:** Node `--experimental-strip-types` services (`services/analyze`,
`services/snapshot`), Postgres `facts`/`metrics`, React 19 + Tailwind v4 web.

---

## Why revenue_bars (and not analyst_consensus)

The parent bead `fra-6syg` recommended wiring `analyst_consensus` first "because data
exists." Investigation proved that premise **false**:

- `buildAnalystConsensus` has **zero production callers**. The prod consensus repository
  is hard-wired to `createUnsupportedConsensusRepository()` → always returns `null`.
- There is no provider/HTTP fetcher, no DB table, and no seed rows for analyst data — all
  consensus data is test fixtures.
- `GET /v1/fundamentals/consensus` returns 404 for every real issuer, so the "already
  covered in Symbol Overview" claim is also false.

Of the three stubs, **only `revenue_bars` is backed by real data**: SEC ingestion writes
discrete quarterly revenue facts. `analyst_consensus` and `price_target_range` are
deferred behind `fra-tcav` (ingest analyst-consensus data).

---

## Data availability (verified)

Quarterly revenue facts physically exist after SEC ingestion, each with its own
`fact_id`:

- `facts` columns: `fact_id`, `subject_kind`/`subject_id`, `metric_id`, `period_kind`
  (`check in ('point','fiscal_q','fiscal_y','ttm','range')`), `period_start`/`period_end`,
  `fiscal_year`, `fiscal_period` (`'Q1'..'Q4'`, `'FY'`), `value_num` (numeric), `unit`,
  `currency`, `scale`, `as_of`, `source_id`, `method` (`'reported'`), `superseded_by`,
  `invalidated_at`.
- `metrics` registers `metric_key='revenue'` (`db/seed/metrics.sql`).
- Migration `0026_sec_fact_identity` guarantees exactly one active (non-superseded) fact
  per `(subject, metric, period_kind, fiscal_year, fiscal_period, source, method)`.

**Loader SQL (sketch):**

```sql
select f.fact_id::text as fact_id, f.fiscal_year, f.fiscal_period,
       f.period_end, f.value_num, f.unit, f.currency, f.scale,
       f.as_of, f.source_id::text as source_id
  from facts f
  join metrics m on m.metric_id = f.metric_id
 where f.subject_kind = 'issuer'
   and f.subject_id = $1::uuid
   and m.metric_key = 'revenue'
   and f.period_kind = 'fiscal_q'
   and f.fiscal_period in ('Q1','Q2','Q3','Q4')
   and f.method = 'reported'
   and f.invalidated_at is null
   and f.superseded_by is null
 order by f.fiscal_year desc,
          case f.fiscal_period when 'Q4' then 4 when 'Q3' then 3
                               when 'Q2' then 2 when 'Q1' then 1 end desc
 limit 8;
```

Rows are reversed (oldest → newest) for display.

---

## Data flow

```
runDeterministicSections (existing, fra-tx2o)
  └─ earnings_quality:revenue_trend → REVENUE_BARS_PRODUCER (new registry entry)
       └─ emitRevenueBarsBlock(deps, ctx)            revenue-bars-emitter.ts
            1. loadQuarterlyRevenueFacts(db, issuerId, 8)
            2. buildRevenueBarsBlock({ facts, primary, base })   revenue-bars-block-builder.ts (pure)
                 magnitude = nativeValue / maxNativeValue   (peak bar = 1)
                 format    = compact currency(nativeValue)   nativeValue = value_num * scale
                 label     = "Q3 2024";  value_ref = fact_id;  ordered oldest → newest
            3. loadFactRows(db, factIds) → buildRevenueBarsSealInput(...)  revenue-bars-snapshot.ts
                 manifest.fact_refs = bar value_refs; subject_refs = [issuer];
                 source_ids = distinct(source_id)
       └─ returns SnapshotSealInput | null  → merged + sealed by existing run flow
```

The verifier needs **no changes**: `normalizeBlock` carries `bars` through whole,
`extractBlockRefs` already binds `bar.value_ref`/`bar.delta_ref`, and `revenue_bars` is a
known kind. Adding `magnitude`/`format` to bars is safe — they become part of the sealed,
hashed content (deterministic from the facts).

---

## Files

### Create (3)

- `services/analyze/src/revenue-bars-block-builder.ts` — pure
  `buildRevenueBarsBlock({ facts, primary, base }) → RevenueBarsBlock`. Computes
  `magnitude` (native value / max native value; guards max = 0) and `format` (compact
  currency of `value_num * scale`, using each fact's `currency`). Drops facts with null
  `value_num`. Bars
  ordered oldest → newest. Returns a block; the emitter decides null when no bars.
- `services/analyze/src/revenue-bars-snapshot.ts` —
  `buildRevenueBarsSealInput({ block, facts }) → SnapshotSealInput`. Mirrors
  `buildPeerComparisonSealInput`: validates every bar `value_ref` has a loaded fact row,
  assembles the `SnapshotManifestDraft` (`fact_refs` = bar value_refs, `subject_refs` =
  `[issuer]`, `source_ids` = distinct sources), returns the seal input.
- `services/analyze/src/revenue-bars-emitter.ts` —
  `emitRevenueBarsBlock(deps, input) → SnapshotSealInput | null`. Loads the 8 quarterly
  facts; returns `null` when none. Calls the builder, loads fact rows, returns the seal
  input. Same `SectionProducerDeps`/context shape as the peer producer.

### Modify (4)

- `spec/finance_research_block_schema.json` — on the `RevenueBars` bar item (currently
  `{ label, value_ref, delta_ref? }`, `additionalProperties:false`) add optional
  `magnitude` (number) and `format` (string). Keep `additionalProperties:false`.
- `services/analyze/src/section-producers.ts` — add `REVENUE_BARS_PRODUCER` and register
  `["earnings_quality:revenue_trend", REVENUE_BARS_PRODUCER]` in `SECTION_PRODUCERS`.
- `services/analyze/src/playbook.ts` — add
  `section("revenue_trend", "Revenue trend", false, "line_chart")` to the
  `earnings_quality` playbook (`required: false` so it doesn't force memo authors).
- `web/src/blocks/RevenueBars.tsx` + `web/src/blocks/types.ts` — bar type gains
  `magnitude?: number`, `format?: string`; render `height = magnitude * 100%` and the
  `format` label; fall back to the existing stub (`60%` height, em-dash) when absent.

---

## Error handling / degradation

- **< 8 quarters:** emit the bars that exist (fewer columns).
- **0 facts:** emitter returns `null` → the section is skipped, exactly like `peer_table`
  with no peers.
- **All-zero / null `value_num`:** guard division (max = 0 → magnitude 0); skip facts with
  null `value_num` before building bars.
- **Backward compatibility:** `magnitude`/`format` are optional, so older sealed blocks
  (without them) still render via the stub fallback.

---

## Scope (YAGNI)

- **Skip `delta_ref` / YoY for v1.** The schema keeps `delta_ref` optional; no delta facts
  are computed. Tracked as a follow-up.
- **No new web primitive.** `RevenueBars.tsx` already draws bar columns; we only feed real
  heights and labels.

---

## Testing

- `services/analyze/test/revenue-bars-block-builder.test.ts` — magnitude normalization
  (peak bar = 1), compact-currency format using `value_num * scale`, oldest → newest
  ordering, null `value_num` dropped, max = 0 guard.
- `services/analyze/test/revenue-bars-emitter.test.ts` — fake db returning 8 quarterly
  facts → block + `verifySnapshotSeal(...).ok === true` with `fact_refs` bound; the < 8
  and 0-fact paths (0 → `null`).
- Section-producer registry test — `lookupSectionProducer("earnings_quality",
  "revenue_trend")` resolves to the producer.
- Web `RevenueBars` render test — heights derived from `magnitude`, labels from `format`,
  and the stub fallback when both are absent.
- **Optional** DB-gated e2e mirroring `peer-comparison-run.integration.test.ts` (skipped
  unless a `*_E2E_DATABASE_URL` env var is set), proving a real issuer yields a
  verifier-valid `revenue_bars` block from live facts.

---

## Bead restructuring

- `fra-ef24` — this work (revenue_bars end-to-end). **In progress.**
- `fra-tcav` — ingest analyst-consensus data (provider fetcher / dev-provider sidecar).
  Blocks the analyst/price-target stubs.
- `fra-6syg` — corrected premise; now depends on `fra-ef24` and `fra-tcav`.
