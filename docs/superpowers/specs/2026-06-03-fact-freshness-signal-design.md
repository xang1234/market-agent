# Fact Freshness Signal Design (fra-x3ii)

**Status:** Approved (design phase)
**Bead:** fra-x3ii — "Base statement facts have no freshness/age signal (stale 10-K served as current)"
**Date:** 2026-06-03

## Problem

The chat analyst loads issuer fundamentals via `loadIssuerFacts` and surfaces each fact's `as_of`, `fiscal_year`, and `fiscal_period` to the LLM. But there is **no explicit, computed recency signal** — the LLM must do date math against "now" itself, and (per the pipeline audit) it doesn't reliably. So a company whose newest reported data is a 2-year-old 10-K is presented as if current. Only derived composites (key-stats, segments, consensus) emit staleness warnings today; base statement facts do not.

## Goal

Give the analyst one explicit, hard-to-ignore recency signal for the loaded fact set, so it caveats stale filings. Mirror the quote `stale` precedent shipped in fra-eixm (`QuoteSummary.stale` computed via `cachedQuoteIsFresh` against a threaded `now`).

## Decisions (locked)

1. **Set-level, not per-fact.** A loaded fact set deliberately spans old comparison years (FY2024, FY2023, FY2022…). Per-fact staleness would mislabel intentional comparison rows. The recency question — "how recent is the newest reported data?" — is answered once, over the whole set.
2. **Age + a hard `stale` boolean.** Expose the latest `as_of`, its fiscal period, a computed `age_days`, AND a `stale` boolean. Consistent with the quote `stale` flag; gives the analyst a force-function, not just data to interpret.

Rejected alternatives: per-fact flag (mislabels comparison years); recency-without-boolean (softer signal the LLM may under-weight); a `fiscalPeriodToDate` helper (unnecessary — `as_of` is already the materialized filing/period date).

## Background (verified)

- A fact's `as_of` (timestamptz, not null) is the **filing/period date**, populated from `statement.as_of` in `persistStatementFacts` — *not* the ingestion date (that's `observed_at`). So `as_of` is the correct basis for "how old is this reported data."
- `IssuerFactSummary` already carries `as_of`, `fiscal_year`, `fiscal_period` (`services/chat/src/local-runtime-structured.ts`). No schema or query change is needed — the signal is a pure derivation over already-loaded facts.
- `loadStructuredSubjectContext` already threads a `now` (the turn's `asOf`) for quote staleness; the fact signal reuses it.
- Anything added to `StructuredSubjectContext` / the `structured_context` object reaches the analyst LLM, because `summarizeToolCall` spreads the whole tool result (`services/chat/src/llm-runtime.ts`). No allowlist to update.

## Architecture

One pure helper + one field, in the module that already owns analyst structured context. No new files.

```text
services/chat/src/local-runtime-structured.ts
  + type FactRecency
  + const STALE_FACT_AGE_DAYS = 400
  + factRecencyFrom(facts, now): FactRecency | null   // pure, canonical, testable
  + StructuredSubjectContext.fact_recency: FactRecency | null
services/chat/src/local-runtime.ts
  + structured_context.fact_recency                    // surfaced to the analyst LLM
```

### The signal

```ts
export type FactRecency = {
  latest_as_of: string;            // newest fact's filing/period date (ISO)
  fiscal_year: number | null;      // that fact's fiscal year
  fiscal_period: string | null;    // that fact's fiscal period ("FY", "Q3", …)
  age_days: number;                // floor((now − latest_as_of) / 1 day), min 0
  stale: boolean;                  // age_days > STALE_FACT_AGE_DAYS
};
```

`StructuredSubjectContext` gains `fact_recency: FactRecency | null` (null when the set is empty).

### `factRecencyFrom(facts, now)`

Pure function. Given the loaded `ReadonlyArray<IssuerFactSummary>` and an ISO `now`:

- If `facts` is empty → return `null`.
- Pick the fact with the **maximum `as_of`** (the newest reported data) — not `facts[0]`, since the query orders by `fiscal_year desc` then `as_of desc` then `metric_key`, so the first row is not guaranteed to be the global max `as_of` across mixed metrics. Computing the max explicitly is robust to ordering.
- `age_days = Math.max(0, Math.floor((Date.parse(now) − Date.parse(latest.as_of)) / 86_400_000))`. The `max(0, …)` guards against a filing date marginally ahead of `now`.
- `stale = age_days > STALE_FACT_AGE_DAYS`.
- Carry the chosen fact's `fiscal_year` / `fiscal_period`.

### `STALE_FACT_AGE_DAYS = 400`

Documented rationale inline: even an annual-only filer reports within ~365 days, plus a filing lag; >400 days means the issuer has effectively stopped reporting or the ingestion pipeline is behind. Deliberately not a per-quarter threshold — it flags genuinely-overdue data, not normal quarterly gaps.

### Threading & surfacing

- `loadStructuredSubjectContext` computes `fact_recency = factRecencyFrom(facts, now)` after the facts settle, using the `now` it already derives, and includes it on the returned `StructuredSubjectContext`.
- `local-runtime.ts` `executeTool` adds `fact_recency: structured.fact_recency` to the `structured_context` object it returns. That object is already spread to the analyst LLM.

## Deliberately unchanged

- **`structuredEvidenceStatus`** still counts facts as `available` regardless of `fact_recency.stale` — a stale fact is still evidence, just flagged (same policy as a stale quote). Suppressing it would resurrect the "insufficient data" failure.
- No DB columns, no migration, no query change. `freshness_class` (hardcoded `'filing_time'`) is left as-is.

## Error handling

`factRecencyFrom` is total: empty input → `null`; an unparseable `as_of` would yield `NaN` age — guarded by treating `NaN` like a missing date (skip that fact when choosing the max; if none parse, return `null`). No throws; the facts load already degrades independently (fra-hsk0).

## Testing

- **Unit (`factRecencyFrom`)**, in `services/chat/test/local-runtime-structured.test.ts`:
  - Fresh set (latest `as_of` 30 days before `now`) → `stale:false`, `age_days:30`, carries the latest fact's period.
  - Stale set (latest `as_of` 500 days before `now`) → `stale:true`, `age_days:500`.
  - Multi-period set where the max `as_of` is **not** the first row → picks the true newest, not `facts[0]`.
  - Boundary: `age_days` exactly 400 → `stale:false`; 401 → `stale:true`.
  - Empty set → `null`.
  - Filing date marginally after `now` → `age_days:0`, not negative.
- **Context (`loadStructuredSubjectContext`)**: seeded facts (via the existing routed-fake-`QueryExecutor` harness) against a fixed `now` populate `fact_recency`; an issuer with no facts → `fact_recency: null`.

## Out of scope (YAGNI)

Per-fact flags; a `fiscalPeriodToDate` helper; changing `freshness_class`; any UI/frontend surfacing (analyst-context only); thresholds tuned per filer type.

## Acceptance

The analyst-facing `structured_context` exposes a set-level `fact_recency` (latest `as_of` + fiscal period + `age_days` + `stale`) derived from the loaded facts against the turn clock, so old filings can be caveated. Covered by unit + context tests.
