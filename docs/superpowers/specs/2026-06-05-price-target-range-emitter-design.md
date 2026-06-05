# price_target_range Emitter + Disclosure Infra (fra-kikf) — Design

**Bead:** `fra-kikf` (deferred from `fra-6syg`). Consumes `fra-23ou`
(`materializePriceFact`) + the consensus envelope's `price_target`. Closes the
stub-blocks epic.

**Goal:** Seal a verifier-valid `price_target_range` block from analyst price
targets + a current-price fact, emit the freshness disclosure the price fact
demands, and render an inline range bar.

**Tech stack:** Node `--experimental-strip-types` (`services/analyze`,
`services/snapshot`, `services/evidence`, `services/market`, `services/fundamentals`),
Postgres, React 19 web.

---

## Data flow

```
earnings_quality:price_targets → PRICE_TARGET_RANGE_PRODUCER
  └─ emitPriceTargetRangeBlock({ db, consensus, price, clock }, ctx)
       envelope = await consensus.find(ctx.primary.id)
       quote    = await price.findByIssuer(ctx.primary.id)
       if envelope?.price_target == null || quote == null → return null
       targets = materializePriceTargetFacts(db, { issuer: ctx.primary, priceTarget: envelope.price_target, clock })
       priceFact = materializePriceFact(db, { quote, clock })            // fra-23ou, FULL row
       block = buildPriceTargetRangeBlock({ targets, priceFact, current: quote.price, base })
       seal  = buildPriceTargetRangeSealInput({ block, facts, primary: ctx.primary, listing: quote.listing })
       return seal                                                       // already disclosure-wrapped
```

---

## The reusable disclosure helper (novel infra)

`withRequiredDisclosures(seal: SnapshotSealInput): SnapshotSealInput`, added to
`services/analyze/src/block-seal-input.ts` beside `buildFactBackedSealInput`:

- Calls `compileDisclosurePolicy({ snapshot_id, manifest: { subject_refs,
  source_ids, as_of, basis, normalization }, facts: seal.facts })`.
- If `required_disclosure_blocks` is empty → returns `seal` unchanged (the common
  case: revenue_bars/analyst carry no freshness).
- Else returns `{ ...seal, blocks: [...seal.blocks, ...required_disclosure_blocks] }`.

The `DisclosureBlockDraft`s are already sealable (`kind:"disclosure"`,
`data_ref:{kind:"disclosure_policy",id:"required"}`, `disclosure_tier`, `items`,
`source_refs`, no fact_refs). The verifier re-derives the same required
disclosures from the seal's facts, so coverage matches **by construction** — no
hand-built items, no mismatch risk. The disclosure's `source_refs` (the price
fact's source) are already in the manifest `source_ids` (the price fact is bound),
so nothing else changes.

`price-target-range-snapshot.ts` composes: `withRequiredDisclosures(buildFactBackedSealInput(...))`.

---

## Facts & subjects

- **Price-target facts** — `materializePriceTargetFacts(db, { issuer, priceTarget, clock })`
  mints 3 `subject_kind='issuer'`, `method='vendor'`, `period_kind='point'` facts
  for metric_keys `price_target_low` / `price_target_mean` / `price_target_high`,
  value = the target price, `unit='currency'`, `currency = priceTarget.currency`,
  `period_end = priceTarget.as_of` date, `source_id = priceTarget.source_id`,
  `freshness_class='eod'`, `verification_status='authoritative'`. Returned **lean**
  (via `toSealFactRow`) so they demand no disclosure (analyst opinion, not a market
  price). Returns `{ low:{ref,value}, mean:{ref,value}, high:{ref,value}, currency, factRows }`.
- **Current-price fact** — `materializePriceFact` (fra-23ou): `subject_kind='listing'`,
  **full** row (surfaces freshness → pricing disclosure). `current_price_ref =
  priceFact.fact_id`, current value = `quote.price`.
- The block binds mixed subjects (issuer targets + listing price); the seal's
  `subjectRefs = [issuer, listing]`. `upside_ref` is **omitted** for v1 (an
  EOD-price-vs-stale-consensus upside misleads; the field is schema-optional).

New metric_keys to seed (`db/seed/metrics.sql`, idempotent): `price_target_low`,
`price_target_mean`, `price_target_high` (`currency`, `point_in_time`, `vendor`).

---

## Block + schema (range bar display)

`buildPriceTargetRangeBlock` produces `{ kind:'price_target_range',
data_ref:{kind:'price_target_range'}, current_price_ref, low_ref, avg_ref,
high_ref, source_refs, as_of, display }` where `avg_ref = mean fact`.

`display` is the new optional schema object the web renders from:

```
display: {
  current: { position: number, format: string },
  low:     { position: number, format: string },
  avg:     { position: number, format: string },
  high:    { position: number, format: string },
}
```

- `position` ∈ [0,1]: `low=0`, `high=1`, `avg=(mean-low)/(high-low)`,
  `current=clamp((current-low)/(high-low), 0, 1)`. Guard `high==low` → all 0.
- `format`: non-compact currency (e.g. `$214.50`) via a new
  `formatCurrency(value, currency)` in `block-format.ts` (Intl, 2 fraction digits,
  not compact — prices need precision, unlike revenue's compact `$3.2B`).

Schema: add `display` to `$defs.PriceTargetRange` (object, each point
`{position:number 0..1, format:string}`, `additionalProperties:false`); keep the
existing required refs. Regenerate `web/src/blocks/blockSchema.json` via
`sync:schema`.

---

## Quote source threading

`SectionProducerDeps` gains `price?: CurrentPriceSource`
(`{ findByIssuer(issuerId: string): Promise<NormalizedQuote | null> }`), defined
with a `createCurrentPriceSource(profiles, cache)` factory in new
`services/analyze/src/current-price-source.ts`. The factory encapsulates
issuer → `profiles.find(id).exchanges[0].listing` → `cache.findLatestQuote(listing)`.
dev-api's `analyzeSectionDeps` composes it from `createPostgresIssuerProfileRepository(db)`
+ `createPostgresMarketCacheRepository(db)` (mirroring the consensus wiring). Absent
`price` dep → the producer returns null (section omitted).

The producer is registered `earnings_quality:price_targets`; a `price_targets`
section is added to the `earnings_quality` playbook (`required:false`).

---

## Web

`web/src/blocks/PriceTargetRange.tsx` renders an inline horizontal range bar
(mirror `web/src/symbol/consensusViews.tsx` `PriceTargetBody`): a track with the
low/high ends, markers for `avg` and `current` at `position*100%`, and the four
`format` labels. Falls back to the existing em-dash `LabelValueCell` grid when
`display` is absent. `PriceTargetRangeBlock` type gains `display?`; the fixture
gains `display`.

---

## Error handling / degradation

- No `price_target` in the envelope, or no quote (cache miss / no listing) →
  producer returns null → section omitted (graceful, like analyst/peer with no data).
- `high == low` → positions all 0 (guarded, no NaN).
- New schema/display + metrics are additive; older sealed blocks still render via
  the stub fallback.

---

## Files

**Create:** `services/analyze/src/price-target-materializer.ts`,
`price-target-range-block-builder.ts`, `price-target-range-snapshot.ts`,
`price-target-range-emitter.ts`, `current-price-source.ts` (+ test files);
`web/src/blocks/PriceTargetRange.test.tsx`.
**Modify:** `services/analyze/src/block-seal-input.ts` (`withRequiredDisclosures`),
`block-format.ts` (`formatCurrency`), `section-producers.ts` (producer + `price?`
dep), `playbook.ts` (`price_targets` section), `services/dev-api/src/local-runtime.ts`,
`db/seed/metrics.sql`, `spec/finance_research_block_schema.json` (+
`web/src/blocks/blockSchema.json`), `web/src/blocks/PriceTargetRange.tsx`,
`web/src/blocks/types.ts`, `web/src/blocks/fixtures.ts`.

---

## Testing

- `withRequiredDisclosures`: an `eod`-freshness fact → a disclosure block appended
  with matching tier/items/source_refs; lean facts → no-op (seal unchanged).
- `price-target-materializer`: 3 issuer vendor facts minted (metric_ids, values,
  currency, source), returned lean.
- `price-target-range-block-builder`: positions (low=0, high=1, avg/current
  interpolation, high==low guard), formats, refs, `avg_ref=mean`.
- `price-target-range-snapshot` / emitter: fake `ConsensusRepository` + fake
  `CurrentPriceSource` + fake db → block + **`verifySnapshotSeal(...).ok===true`
  with the disclosure block present**; null paths (no price_target / no quote).
- `section-producers`: `earnings_quality:price_targets` resolves.
- web: range-bar render from the fixture `display` + stub fallback +
  `validateBlock(fixture).valid`.

---

## Acceptance

- `emitPriceTargetRangeBlock` returns a verifier-valid `SnapshotSealInput` whose
  blocks are `[price_target_range, disclosure]`, binding the 3 target facts + the
  current-price fact, with the pricing disclosure covering the current-price
  fact's freshness; null when no price_target or no quote.
- The web renders a real range bar with formatted prices; the fixture validates.
- `earnings_quality` runs emit the block when consensus price targets + a quote
  are available, omit it otherwise. Closes `fra-6syg`.
