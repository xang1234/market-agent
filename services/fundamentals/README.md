# Fundamentals

Tracking beads: `fra-cw0.3` (and child beads `fra-cw0.3.1` … `fra-cw0.3.4`).

The fundamentals service: the issuer-anchored layer that turns
filing-backed or vendor-backed statement inputs into canonical value
objects keyed by metric definitions (spec §6.3.1).

## Filing Extraction Boundary

Filing extraction remains an integrated Evidence/Fundamentals boundary for the
current implementation stage; see
`docs/adr/0003-filing-extraction-boundary.md`.

Fundamentals owns the issuer-normalization side of the contract:

- SEC companyfacts ingestion for issuer-level statement facts;
- fiscal calendar and period normalization;
- metric mapping into canonical statement lines;
- segment fact and fundamentals read models.

Evidence owns raw filing documents, Inline XBRL extension/candidate extraction,
claims/events, review promotion, and raw blob storage. Callers should hand
Fundamentals issuer identity and Evidence-promoted facts or normalized filing
inputs, not raw filing bytes or ticker-only identifiers.

All four child beads of `fra-cw0.3` have landed:

- `fra-cw0.3.1` — canonical statement value object
- `fra-cw0.3.2` — fiscal-calendar normalization
- `fra-cw0.3.3` — metric mapper
- `fra-cw0.3.4` — SEC EDGAR primary-source anchor (this module)

## Fiscal calendar

`src/fiscal-calendar.ts` maps issuer-specific fiscal calendars to the
canonical period labels that `normalizedStatement` consumes. Three calendar
kinds cover the dominant patterns:

- `calendar` — FY = calendar year; quarters end on the last day of Mar /
  Jun / Sep / Dec.
- `fixed_month_end` — FY ends on the last day of a chosen month (e.g.
  Microsoft, June 30); quarters are the last day of each prior 3-month step.
- `last_weekday` — 52/53-week fiscal year ending on the last `<weekday>`
  of a chosen month (e.g. Apple, last Saturday of September). Quarters Q2–Q4
  are exactly 13 weeks back from FY end; Q1 absorbs the 53rd week when
  present.

The acceptance criterion (`fra-cw0.3.2`) is that AAPL FY25 and calendar
2025 are not silently merged: their `period_end`s are `2025-09-27` and
`2025-12-31` respectively.

## Metric mapper

`src/metric-mapper.ts` resolves `metric_key` strings on `StatementLine`s
to canonical `metric_id` UUIDs from the `metrics` table. The contract is
that **every normalized line maps to exactly one metric_id** — an
unmapped line would let a displayed number reach a surface without a
backing row in `Fact`/`Computation`, violating I1.

`createMetricRegistry(definitions[])` builds an immutable registry that
rejects duplicate keys and duplicate ids. `mapStatement(registry, s)`
returns the same statement with `metric_id` and `canonical_source_class`
attached to every line, plus a unit-class compatibility check (e.g., a
`currency` line cannot map to a `shares` metric). Callers can pass
`{ canonical_source_class: "ifrs" }` to require IFRS metric definitions
and fail fast instead of silently mapping IFRS statements onto GAAP rows.

## SEC EDGAR primary-source anchor

`src/sec-edgar.ts` integrates the `data.sec.gov` companyfacts API: it
models the response schema, fetches via an injected `SecEdgarFetcher`
(matching the market service's adapter pattern), maps US-GAAP concept
names to canonical `metric_key`s aligned with `db/seed/metrics.sql`, and
extracts a `NormalizedStatementInput` for a given (fiscal_year,
fiscal_period, family) tuple. `buildSecSource(...)` produces the `Source`
row that downstream `Fact` rows reference for primary-source provenance.

Acceptance criterion (`fra-cw0.3.4`): pulling AAPL FY2024 companyfacts,
extracting the income statement, and mapping through the metric registry
produces a `MappedStatement` whose every line carries both an SEC
`source_id` and a resolved `metric_id`.

The US-GAAP concept map collapses naming-convention drift across GAAP
revisions — e.g. `Revenues`, `SalesRevenueNet`, and the post-ASC 606
`RevenueFromContractWithCustomerExcludingAssessedTax` all map to
`metric_key: "revenue"` so a 20-year history reads as one series.

## Commands

```bash
cd services/fundamentals
npm test         # contract + AAPL FY2024 income statement verification
```

## Contract notes

- Statement reads anchor on **issuer** identity (not listing or ticker);
  fra-6al.4 / P0.3b is the upstream subject handoff.
- The three statement families are explicit: `income`, `balance`,
  `cashflow`. They are never collapsed into a single "fundamentals" blob.
- Statement basis is explicit: `as_reported` and `as_restated` are
  distinct normalization modes and must not be silently merged. A
  restatement is a separate `NormalizedStatement` whose later promotion
  path (`facts.supersedes` / `superseded_by`) keeps the original visible.
- SEC ingestion records a financial context (`fact_financial_contexts`)
  for every fact taken from a source token: `as_reported`, `original`,
  consolidated, unadjusted. EPS and weighted-average share counts are
  `as_filed` instead, on the split basis of the filing date companyfacts
  lists beside them (#387). Capex is
  certified only from `PaymentsToAcquirePropertyPlantAndEquipment`;
  capex mapped from `PaymentsToAcquireProductiveAssets` still appears in
  statements but gets no context, since that concept adds purchased
  intangibles. Operating cash flow is certified only from the total
  `NetCashProvidedByUsedInOperatingActivities`, the scope capex covers;
  the continuing-operations line gets no context. A balance is certified
  only from a 10-K: the statement contract labels every balance `FY` of
  its fiscal year, so a 10-Q balance is stored as `FY` at the quarter's
  end, and it appears in statements but gets no context.
- A 10-K's comparative for an earlier year that differs from the
  previous filing's value for it, in filing-date order, is stored as a
  restatement: `method = 'restated'`, on the later filing's source,
  `reported_at` its filing date, `supersedes` naming the original, with
  an `as_restated` / `economic_restatement` context. Every ingest checks
  each stored original against every later 10-K in its companyfacts
  download, which lists all of the issuer's filings, so the result does
  not depend on which year was ingested first. An unchanged comparative,
  two different values in one filing, or an original without a recorded
  concept adds nothing. Readers of as-reported facts filter `method =
  'reported'`, or `method <> 'restated'` where they also read vendor and
  derived facts (analyst grids, thesis evidence), so they never see a
  restatement; only certified selection
  with `as_restated` picks it, taking the restatement filed last among
  those public at the cutoff.
- An as-filed EPS or share count is compared after restating the previous
  filing's figure by the listing's splits between the two filing dates. A
  comparative those splits explain adds nothing, and one they do not is a
  restatement as filed on its 10-K's date. A comparative stored while the
  listing's splits through its filing date are not on file is an
  `unverified_restatement`. Selection with `as_restated` reports
  `restatement_unverified` for it until a rerun after
  `npm run sync:splits` decides it.
- Period selection, fiscal labels, scale, and unit are part of the
  contract, not caller-side cleanup. `value_num × scale` resolves to the
  native unit (e.g. millions × 1_000_000 = native USD).
- A line whose `value_num` is `null` MUST carry `coverage_level !=
  "full"`; this preserves coverage when source material is incomplete or
  pending promotion instead of inventing a UI-only "unknown" cell.
