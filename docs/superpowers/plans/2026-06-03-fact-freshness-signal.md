# Fact Freshness Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a set-level recency signal (`fact_recency`) for issuer fundamentals to the chat analyst so stale filings get caveated instead of presented as current.

**Architecture:** A pure `factRecencyFrom(facts, now)` helper derives the newest fact's `as_of`, fiscal period, `age_days`, and a `stale` boolean (threshold 400 days). `loadStructuredSubjectContext` computes it over the already-loaded facts using the `now` it already threads, and adds `fact_recency` to `StructuredSubjectContext`. `local-runtime.ts` includes it in the `structured_context` object, which is already spread to the analyst LLM. No schema or query change.

**Tech Stack:** Node `--experimental-strip-types`, `node:test`. Tests run with `cd services/chat && npm test` (= `node --experimental-strip-types --test "test/**/*.test.ts"`); single file: `node --experimental-strip-types --test test/local-runtime-structured.test.ts`.

**Spec:** `docs/superpowers/specs/2026-06-03-fact-freshness-signal-design.md`. **Bead:** fra-x3ii.

**Commit trailer (every commit):** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- Modify `services/chat/src/local-runtime-structured.ts` — add `FactRecency` type, `STALE_FACT_AGE_DAYS`, `factRecencyFrom`, the `StructuredSubjectContext.fact_recency` field, and the computation in `loadStructuredSubjectContext`.
- Modify `services/chat/src/local-runtime.ts` — add `fact_recency` to the `structured_context` object in `executeTool`.
- Modify `services/chat/test/local-runtime-structured.test.ts` — unit tests for `factRecencyFrom` and a context test for `fact_recency`.

Context (already present in `local-runtime-structured.ts`):
- `IssuerFactSummary` has `as_of: string`, `fiscal_year: number | null`, `fiscal_period: string | null`.
- `loadStructuredSubjectContext` already computes `const now = options.now ?? new Date().toISOString()` and returns a frozen `{ facts, quote, source_ids }`.
- The test file already has a routed-fake `QueryExecutor` (`routedDb`), `REFS_WITH_LISTING`, and a `FACT_ROW` fixture.

---

### Task 1: `factRecencyFrom` pure helper

**Files:**
- Modify: `services/chat/src/local-runtime-structured.ts`
- Test: `services/chat/test/local-runtime-structured.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `services/chat/test/local-runtime-structured.test.ts`. First extend the import to include the new symbols:

```ts
import {
  factRecencyFrom,
  factSummaryFromRow,
  loadStructuredSubjectContext,
  quoteSummaryFromCachedQuote,
  STALE_FACT_AGE_DAYS,
  structuredEvidenceStatus,
  structuredRefsFromHandoff,
  type IssuerFactSummary,
  type StructuredSubjectRefs,
} from "../src/local-runtime-structured.ts";
```

(The existing import block in this file imports `factSummaryFromRow`, `loadStructuredSubjectContext`, `quoteSummaryFromCachedQuote`, `structuredEvidenceStatus`, `structuredRefsFromHandoff`, `type StructuredSubjectRefs` — replace it with the block above, which adds `factRecencyFrom`, `STALE_FACT_AGE_DAYS`, and `type IssuerFactSummary`.)

Then append the tests:

```ts
// ── factRecencyFrom ───────────────────────────────────────────────────────────

const RECENCY_NOW = "2026-06-03T00:00:00.000Z";
const DAY = 86_400_000;

function factAt(as_of: string, fiscal_year: number | null, fiscal_period: string | null): IssuerFactSummary {
  return factSummaryFromRow({
    metric_key: "revenue",
    display_name: "Revenue",
    value_num: "100",
    value_text: null,
    unit: "currency",
    currency: "USD",
    fiscal_year,
    fiscal_period,
    as_of,
    source_id: POLYGON_SOURCE_ID,
  });
}

function isoDaysBefore(now: string, days: number): string {
  return new Date(Date.parse(now) - days * DAY).toISOString();
}

test("factRecencyFrom returns null for an empty fact set", () => {
  assert.equal(factRecencyFrom([], RECENCY_NOW), null);
});

test("factRecencyFrom reports a fresh set as not stale with the right age and period", () => {
  const recency = factRecencyFrom([factAt(isoDaysBefore(RECENCY_NOW, 30), 2026, "Q1")], RECENCY_NOW);
  assert.ok(recency);
  assert.equal(recency?.age_days, 30);
  assert.equal(recency?.stale, false);
  assert.equal(recency?.fiscal_year, 2026);
  assert.equal(recency?.fiscal_period, "Q1");
});

test("factRecencyFrom flags a set whose newest fact is over the threshold as stale", () => {
  const recency = factRecencyFrom([factAt(isoDaysBefore(RECENCY_NOW, 500), 2024, "FY")], RECENCY_NOW);
  assert.equal(recency?.age_days, 500);
  assert.equal(recency?.stale, true);
});

test("factRecencyFrom picks the newest as_of, not the first row", () => {
  // First row is an older comparison year; the newest fact is last in the array.
  const recency = factRecencyFrom(
    [
      factAt(isoDaysBefore(RECENCY_NOW, 800), 2022, "FY"),
      factAt(isoDaysBefore(RECENCY_NOW, 60), 2026, "Q1"),
    ],
    RECENCY_NOW,
  );
  assert.equal(recency?.age_days, 60);
  assert.equal(recency?.fiscal_year, 2026);
  assert.equal(recency?.stale, false);
});

test("factRecencyFrom treats the threshold boundary as not stale and one day past as stale", () => {
  const atThreshold = factRecencyFrom([factAt(isoDaysBefore(RECENCY_NOW, STALE_FACT_AGE_DAYS), 2025, "FY")], RECENCY_NOW);
  assert.equal(atThreshold?.age_days, STALE_FACT_AGE_DAYS);
  assert.equal(atThreshold?.stale, false);
  const pastThreshold = factRecencyFrom([factAt(isoDaysBefore(RECENCY_NOW, STALE_FACT_AGE_DAYS + 1), 2025, "FY")], RECENCY_NOW);
  assert.equal(pastThreshold?.stale, true);
});

test("factRecencyFrom clamps a future filing date to age 0", () => {
  const recency = factRecencyFrom([factAt(isoDaysBefore(RECENCY_NOW, -5), 2026, "Q2")], RECENCY_NOW);
  assert.equal(recency?.age_days, 0);
  assert.equal(recency?.stale, false);
});

test("factRecencyFrom returns null when no fact has a parseable as_of", () => {
  assert.equal(factRecencyFrom([factAt("not-a-date", 2025, "FY")], RECENCY_NOW), null);
});
```

Note: `POLYGON_SOURCE_ID` is already defined at the top of this test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/chat && node --experimental-strip-types --test test/local-runtime-structured.test.ts`
Expected: FAIL — `factRecencyFrom`/`STALE_FACT_AGE_DAYS` not exported (import error / not a function).

- [ ] **Step 3: Implement the helper**

In `services/chat/src/local-runtime-structured.ts`, add the type and helper. Put the `FactRecency` type next to `QuoteSummary` (after the `QuoteSummary` type definition), and the `STALE_FACT_AGE_DAYS` const + `factRecencyFrom` function near `quoteSummaryFromCachedQuote` (after `factSummaryFromRow`):

```ts
export type FactRecency = {
  latest_as_of: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  age_days: number;
  stale: boolean;
};
```

```ts
// Even an annual-only filer reports within ~365 days plus a filing lag; a newest
// reported fact older than this means the issuer has effectively stopped
// reporting (or ingestion is behind), not a normal quarterly gap.
export const STALE_FACT_AGE_DAYS = 400;

const FACT_RECENCY_DAY_MS = 86_400_000;

// Set-level recency for a loaded fact set: how old is the NEWEST reported fact.
// A fact set deliberately spans old comparison years, so freshness is a property
// of the newest fact, not each row. Pure and clock-injected for testing.
export function factRecencyFrom(
  facts: ReadonlyArray<IssuerFactSummary>,
  now: string,
): FactRecency | null {
  let latest: IssuerFactSummary | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const fact of facts) {
    const ms = Date.parse(fact.as_of);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = fact;
    }
  }
  if (latest === null) return null;
  const age_days = Math.max(0, Math.floor((Date.parse(now) - latestMs) / FACT_RECENCY_DAY_MS));
  return Object.freeze({
    latest_as_of: latest.as_of,
    fiscal_year: latest.fiscal_year,
    fiscal_period: latest.fiscal_period,
    age_days,
    stale: age_days > STALE_FACT_AGE_DAYS,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/chat && node --experimental-strip-types --test test/local-runtime-structured.test.ts`
Expected: PASS (existing tests + 7 new `factRecencyFrom` tests).

- [ ] **Step 5: Commit**

```bash
git add services/chat/src/local-runtime-structured.ts services/chat/test/local-runtime-structured.test.ts
git commit -m "feat(chat): factRecencyFrom — set-level fundamentals recency helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire `fact_recency` into `loadStructuredSubjectContext`

**Files:**
- Modify: `services/chat/src/local-runtime-structured.ts`
- Test: `services/chat/test/local-runtime-structured.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `services/chat/test/local-runtime-structured.test.ts`. This uses the existing `routedDb` harness, `REFS_WITH_LISTING`, and `QUOTE_ROW` fixtures already in the file. It seeds one old fact and asserts `fact_recency` is populated and stale:

```ts
test("loadStructuredSubjectContext derives fact_recency from the loaded facts", async () => {
  const oldFactRow = {
    metric_key: "revenue",
    display_name: "Revenue",
    value_num: "190872000",
    value_text: null,
    unit: "currency",
    currency: "USD",
    fiscal_year: 2024,
    fiscal_period: "FY",
    as_of: "2025-01-01T00:00:00.000Z", // ~518 days before the now below
    source_id: "00000000-0000-4000-a000-000000000002",
  };
  const ctx = await loadStructuredSubjectContext(
    routedDb({ facts: () => [oldFactRow], quote: () => [QUOTE_ROW] }),
    REFS_WITH_LISTING,
    { now: "2026-06-03T00:00:00.000Z" },
  );

  assert.ok(ctx.fact_recency);
  assert.equal(ctx.fact_recency?.fiscal_year, 2024);
  assert.equal(ctx.fact_recency?.latest_as_of, "2025-01-01T00:00:00.000Z");
  assert.equal(ctx.fact_recency?.stale, true);
});

test("loadStructuredSubjectContext yields null fact_recency when the issuer has no facts", async () => {
  const ctx = await loadStructuredSubjectContext(
    routedDb({ facts: () => [], quote: () => [QUOTE_ROW] }),
    REFS_WITH_LISTING,
    { now: "2026-06-03T00:00:00.000Z" },
  );

  assert.equal(ctx.fact_recency, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/chat && node --experimental-strip-types --test test/local-runtime-structured.test.ts`
Expected: FAIL — `ctx.fact_recency` is `undefined` (property does not exist yet).

- [ ] **Step 3: Add the field to the type**

In `services/chat/src/local-runtime-structured.ts`, find the `StructuredSubjectContext` type:

```ts
export type StructuredSubjectContext = {
  facts: ReadonlyArray<IssuerFactSummary>;
  quote: QuoteSummary | null;
  source_ids: ReadonlyArray<string>;
};
```

Replace it with:

```ts
export type StructuredSubjectContext = {
  facts: ReadonlyArray<IssuerFactSummary>;
  quote: QuoteSummary | null;
  source_ids: ReadonlyArray<string>;
  fact_recency: FactRecency | null;
};
```

- [ ] **Step 4: Compute it in `loadStructuredSubjectContext`**

In the same file, update the return of `loadStructuredSubjectContext`. Find:

```ts
  return Object.freeze({
    facts: Object.freeze(facts),
    quote,
    source_ids: Object.freeze(sourceIds),
  });
}
```

Replace with:

```ts
  return Object.freeze({
    facts: Object.freeze(facts),
    quote,
    source_ids: Object.freeze(sourceIds),
    fact_recency: factRecencyFrom(facts, now),
  });
}
```

(`now` is already in scope — it is computed at the top of the function and threaded to the quote loader.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/chat && node --experimental-strip-types --test test/local-runtime-structured.test.ts`
Expected: PASS (all prior tests + 2 new context tests).

Note: if any existing test constructed a `StructuredSubjectContext` literal by hand, it would now fail to typecheck — but services run via strip-types (no typecheck) and the only producer of this type is `loadStructuredSubjectContext`, so no literal needs updating. Confirm by running the next step.

- [ ] **Step 6: Run the full chat suite (no regression)**

Run: `cd services/chat && npm test`
Expected: PASS (all tests).

- [ ] **Step 7: Commit**

```bash
git add services/chat/src/local-runtime-structured.ts services/chat/test/local-runtime-structured.test.ts
git commit -m "feat(chat): attach fact_recency to structured subject context

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Surface `fact_recency` to the analyst LLM

**Files:**
- Modify: `services/chat/src/local-runtime.ts`

The `structured_context` object returned by `executeTool` is spread wholesale to the analyst LLM via `summarizeToolCall`, so adding the field is all that's needed for the analyst to see it.

- [ ] **Step 1: Add the field to the structured_context object**

In `services/chat/src/local-runtime.ts`, find the `structured_context` object inside `executeTool`:

```ts
        structured_context: {
          quote: structured.quote,
          facts: structured.facts,
          source_ids: structured.source_ids,
        },
```

Replace with:

```ts
        structured_context: {
          quote: structured.quote,
          facts: structured.facts,
          source_ids: structured.source_ids,
          fact_recency: structured.fact_recency,
        },
```

- [ ] **Step 2: Run the full chat suite to verify no regression**

Run: `cd services/chat && npm test`
Expected: PASS (all tests).

- [ ] **Step 3: Commit**

```bash
git add services/chat/src/local-runtime.ts
git commit -m "feat(chat): surface fact_recency in analyst structured_context

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `FactRecency` type + `STALE_FACT_AGE_DAYS=400` + `factRecencyFrom` (spec Architecture / The signal) → Task 1. ✓
- Set-level, picks max `as_of`, `age_days` with `max(0,…)`, NaN-skip, empty→null (spec `factRecencyFrom`) → Task 1 tests + impl. ✓
- `StructuredSubjectContext.fact_recency` computed with threaded `now` (spec Threading & surfacing) → Task 2. ✓
- Surfaced in `structured_context` to the LLM (spec Threading & surfacing) → Task 3. ✓
- `structuredEvidenceStatus` unchanged (spec Deliberately unchanged) → not touched in any task. ✓
- No schema/query change (spec Deliberately unchanged) → no migration task; pure derivation. ✓
- Testing: `factRecencyFrom` units (fresh/stale/multi-period/boundary/empty/future/unparseable) + context tests (spec Testing) → Tasks 1–2. ✓

**Type consistency:** `FactRecency` fields (`latest_as_of`, `fiscal_year`, `fiscal_period`, `age_days`, `stale`) defined in Task 1 are the ones asserted in Task 1/2 tests and consumed in Task 2's return + Task 3's pass-through. `factRecencyFrom(facts, now)` signature is identical across Task 1 (def), Task 1 tests, and Task 2 (call). `STALE_FACT_AGE_DAYS` used in both impl and boundary test. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows real assertions. ✓
