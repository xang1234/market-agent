# Current-Price Fact Materializer (fra-23ou) — Design

**Bead:** `fra-23ou`. Unblocks `fra-kikf` (price_target_range emitter) → `fra-6syg`.

**Goal:** A reusable `materializePriceFact` that mints a `price` fact from a
`NormalizedQuote`, so `price_target_range` can bind a real `current_price_ref`.
Today quotes are only cached (`market_quote_snapshots`), never written to `facts`.

**Tech stack:** Node `--experimental-strip-types` (`services/analyze`,
`services/evidence`, `services/market`), Postgres `facts`/`metrics`.

---

## Scope — just the materializer

`fra-23ou` delivers `materializePriceFact(db, input)` + a `delayClass → freshnessClass`
map, and nothing else. **Deferred to `fra-kikf`** (the consumer): threading a quote
source into the run deps, emitting the `price_target_range` block, and emitting the
disclosure block the price fact demands. This keeps `fra-23ou` small and reusable
(any future market-data block can mint price facts the same way).

---

## The price fact

`materializePriceFact(db, { quote, clock? })` resolves the `price` metric_id by key
and mints one fact via the canonical `createFact`:

| field | value |
|-------|-------|
| `subject_kind` | `'listing'` |
| `subject_id` | `quote.listing.id` |
| `metric_id` | resolved from `metric_key='price'` |
| `period_kind` | `'point'` |
| `period_end` | `quote.as_of` date (`slice(0,10)`) |
| `value_num` | `quote.price` |
| `unit` | `'currency'` |
| `currency` | `quote.currency` |
| `as_of` | `quote.as_of` |
| `observed_at` | `clock().toISOString()` |
| `source_id` | `quote.source_id` |
| `method` | `'vendor'` |
| `verification_status` | `'authoritative'` |
| `freshness_class` | `mapDelayClassToFreshness(quote.delay_class)` |
| `coverage_level` | `'full'` |
| `confidence` | `1` |

Returns the **full `FactRow`** from `createFact` (see "freshness contrast" below).

`method='vendor'` + `period_kind='point'` (no fiscal_year) bypasses the
`facts_active_reported_identity_idx` unique constraint (migration 0026 is `reported`-only),
so repeated mints don't conflict.

### delay_class → freshness_class

```
real_time   → real_time
delayed_15m → delayed_15m
eod         → eod
unknown     → stale
```

### Subject = listing (not issuer)

A price is venue-specific — tied to one listing's session and trading currency — so the
fact's subject is the listing (`quote.listing`), not the issuer. `price_target_range`
(an issuer-level block, via `fra-kikf`) can still bind a listing-subject fact: the
verifier checks only the fact ref, not subject parity between block and fact.

---

## The freshness contrast (load-bearing)

For analyst rating counts, the materializer deliberately **drops** `freshness_class`
(via `toSealFactRow`) so no market-price disclosure is demanded — counts aren't prices.
A **price fact is the opposite**: its freshness is material. `materializePriceFact`
therefore returns the **full `FactRow` with `freshness_class` intact**. When `fra-kikf`
seals it, `compileDisclosurePolicy` (`services/snapshot/src/disclosure-policy.ts`) will
correctly demand `eod_pricing` / `delayed_pricing`, and `fra-kikf` must emit the matching
disclosure block. `fra-23ou` only mints the fact; surfacing-vs-suppressing freshness is
the deliberate, documented difference between the two materializers.

---

## Location & components

- Create `services/analyze/src/price-fact-materializer.ts`:
  - `materializePriceFact(db: QueryExecutor, input: { quote: NormalizedQuote; clock?: () => Date }): Promise<FactRow>` (the full evidence `FactRow`).
  - `mapDelayClassToFreshness(delay: DelayClass): FreshnessClass` (exported for reuse/testing).
  - A `price` metric-id resolver (single-key lookup, mirroring the analyst materializer).
- Imports: `createFact`/`FactInput`/`FactRow` (`services/evidence/src/fact-repo.ts`),
  `NormalizedQuote`/`DelayClass` (`services/market/src/quote.ts`), `QueryExecutor`
  (`services/evidence/src/types.ts`).

---

## Error handling

- `price` metric not registered → throw (clear message), same as the analyst materializer.
- `unknown` delay_class → `stale` freshness (honest, not a hard failure).

---

## Testing

`services/analyze/test/price-fact-materializer.test.ts`:
- Fake db resolves `price` → metric_id and captures the `createFact` insert.
- Assert the inserted fact fields (subject_kind='listing', metric_id, value_num,
  currency, source_id, method='vendor', period_kind='point', period_end).
- Assert `mapDelayClassToFreshness` for all four delay classes.
- Assert the returned row **carries `freshness_class`** (the contrast with the analyst
  lean row).

---

## Out of scope (fra-kikf)

The `price_target_range` emitter, its disclosure-block emission, the quote-source dep
threading into `SectionProducerDeps`, and the web range render.

---

## Acceptance

- `materializePriceFact` mints a verifier-compatible `price` fact from a quote and
  returns it with `freshness_class` set; `mapDelayClassToFreshness` covers all delay
  classes; `unknown → stale`. Tests green.
