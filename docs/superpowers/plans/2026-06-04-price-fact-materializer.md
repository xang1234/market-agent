# Current-Price Fact Materializer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable `materializePriceFact` that mints a `price` fact from a `NormalizedQuote` (bead `fra-23ou`), unblocking `fra-kikf` (price_target_range).

**Architecture:** One pure-ish module beside the other fact materializers. `materializePriceFact(db, {quote, clock?})` resolves the `price` metric_id and mints a `subject_kind='listing'`, `method='vendor'`, `period_kind='point'` fact via `createFact`, with `freshness_class` mapped from `quote.delay_class`. Returns the **full** `FactRow` (freshness intact) — the opposite of the analyst materializer's lean projection.

**Tech Stack:** Node `--experimental-strip-types` (`services/analyze`, `services/evidence`, `services/market`), Postgres.

---

## Background

- Run analyze tests from `services/analyze`: `node --experimental-strip-types --test test/<file>.test.ts`.
- `NormalizedQuote` + `DelayClass` + `DELAY_CLASSES` from `services/market/src/quote.ts`; `createFact`/`FactInput`/`FactRow`/`FreshnessClass` from `services/evidence/src/fact-repo.ts`; `QueryExecutor` from `services/evidence/src/types.ts`.
- `'price'` is already seeded (`db/seed/metrics.sql`). `method='vendor'` + `period_kind='point'` bypasses the reported-only unique index (migration 0026).
- **Freshness contrast:** unlike the analyst materializer (which strips `freshness_class` via `toSealFactRow` to avoid a disclosure), the price fact keeps it — `fra-kikf`'s seal will correctly demand `eod_pricing`/`delayed_pricing`.

---

## Task 1: Price-fact materializer (TDD)

**Files:**
- Create: `services/analyze/src/price-fact-materializer.ts`
- Test: `services/analyze/test/price-fact-materializer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/analyze/test/price-fact-materializer.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { materializePriceFact, mapDelayClassToFreshness } from "../src/price-fact-materializer.ts";
import { DELAY_CLASSES, type NormalizedQuote } from "../../market/src/quote.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";

const LISTING = { kind: "listing", id: "55555555-5555-4555-a555-555555555555" } as const;
const SRC = "00000000-0000-4000-a000-0000000000aa";
const PRICE_METRIC_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001";
const CLOCK = () => new Date("2026-06-04T12:00:00.000Z");

function quote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
  return {
    listing: LISTING,
    price: 214.5,
    prev_close: 210,
    change_abs: 4.5,
    change_pct: 0.0214,
    session_state: "regular",
    as_of: "2026-06-04T19:55:00.000Z",
    delay_class: "delayed_15m",
    currency: "USD",
    source_id: SRC,
    ...overrides,
  };
}

function fakeDb() {
  const inserts: Array<Record<string, unknown>> = [];
  const db: QueryExecutor = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      if (/from metrics/i.test(text)) return { rows: [{ metric_id: PRICE_METRIC_ID }] };
      if (/insert into facts/i.test(text)) {
        const v = params ?? [];
        const row = {
          fact_id: "fac00000-0000-4000-8000-000000000001", subject_kind: v[0], subject_id: v[1],
          metric_id: v[2], period_kind: v[3], period_start: v[4], period_end: v[5], fiscal_year: v[6],
          fiscal_period: v[7], value_num: v[8], value_text: v[9], unit: v[10], currency: v[11],
          scale: v[12], as_of: v[13], reported_at: v[14], observed_at: v[15], source_id: v[16],
          method: v[17], adjustment_basis: v[18], definition_version: v[19], verification_status: v[20],
          freshness_class: v[21], coverage_level: v[22], quality_flags: [], entitlement_channels: [],
          confidence: v[25], supersedes: null, superseded_by: null, invalidated_at: null,
          ingestion_batch_id: null, created_at: v[15], updated_at: v[15],
        };
        inserts.push(row);
        return { rows: [row] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, inserts };
}

test("materializePriceFact mints a listing-scoped vendor price fact carrying freshness", async () => {
  const { db, inserts } = fakeDb();
  const fact = await materializePriceFact(db, { quote: quote(), clock: CLOCK });
  assert.equal(inserts.length, 1);
  const row = inserts[0];
  assert.equal(row.subject_kind, "listing");
  assert.equal(row.subject_id, LISTING.id);
  assert.equal(row.metric_id, PRICE_METRIC_ID);
  assert.equal(row.period_kind, "point");
  assert.equal(row.period_end, "2026-06-04");
  assert.equal(row.value_num, 214.5);
  assert.equal(row.unit, "currency");
  assert.equal(row.currency, "USD");
  assert.equal(row.method, "vendor");
  assert.equal(row.freshness_class, "delayed_15m");
  assert.equal(row.source_id, SRC);
  // The returned row surfaces freshness (unlike the analyst lean row).
  assert.equal(fact.freshness_class, "delayed_15m");
});

test("mapDelayClassToFreshness maps every delay class", () => {
  assert.equal(mapDelayClassToFreshness("real_time"), "real_time");
  assert.equal(mapDelayClassToFreshness("delayed_15m"), "delayed_15m");
  assert.equal(mapDelayClassToFreshness("eod"), "eod");
  assert.equal(mapDelayClassToFreshness("unknown"), "stale");
  // Guard: the map covers every DelayClass value.
  assert.equal(DELAY_CLASSES.length, 4);
});

test("materializePriceFact throws when the price metric is not registered", async () => {
  const db: QueryExecutor = { async query() { return { rows: [] }; } };
  await assert.rejects(() => materializePriceFact(db, { quote: quote() }), /no metric_id registered/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `services/analyze`): `node --experimental-strip-types --test test/price-fact-materializer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `services/analyze/src/price-fact-materializer.ts`:

```ts
// Mints a current-price fact from a market quote: a subject_kind='listing',
// method='vendor', point-in-time fact via the canonical createFact path. Unlike
// the analyst-consensus materializer (which strips freshness so no disclosure is
// demanded), this returns the FULL fact row with freshness_class intact — a
// market price's freshness is material, so the consumer's seal will correctly
// require an eod/delayed pricing disclosure.

import { createFact, type FactInput, type FactRow, type FreshnessClass } from "../../evidence/src/fact-repo.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { DelayClass, NormalizedQuote } from "../../market/src/quote.ts";

const PRICE_METRIC_KEY = "price";
const PRICE_VERIFICATION_STATUS = "authoritative" as const;

export function mapDelayClassToFreshness(delay: DelayClass): FreshnessClass {
  switch (delay) {
    case "real_time":
      return "real_time";
    case "delayed_15m":
      return "delayed_15m";
    case "eod":
      return "eod";
    case "unknown":
      return "stale";
  }
}

export async function materializePriceFact(
  db: QueryExecutor,
  input: { quote: NormalizedQuote; clock?: () => Date },
): Promise<FactRow> {
  const clock = input.clock ?? (() => new Date());
  const metricId = await resolvePriceMetricId(db);
  const { quote } = input;
  return createFact(db, {
    subject_kind: "listing",
    subject_id: quote.listing.id,
    metric_id: metricId,
    period_kind: "point",
    period_end: quote.as_of.slice(0, 10),
    value_num: quote.price,
    unit: "currency",
    currency: quote.currency,
    as_of: quote.as_of,
    observed_at: clock().toISOString(),
    source_id: quote.source_id,
    method: "vendor",
    verification_status: PRICE_VERIFICATION_STATUS,
    freshness_class: mapDelayClassToFreshness(quote.delay_class),
    coverage_level: "full",
    confidence: 1,
  } satisfies FactInput);
}

async function resolvePriceMetricId(db: QueryExecutor): Promise<string> {
  const { rows } = await db.query<{ metric_id: string }>(
    `select metric_id::text as metric_id from metrics where metric_key = $1`,
    [PRICE_METRIC_KEY],
  );
  const id = rows[0]?.metric_id;
  if (id === undefined) {
    throw new Error(`price-fact-materializer: no metric_id registered for "${PRICE_METRIC_KEY}"`);
  }
  return id;
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `services/analyze`): `node --experimental-strip-types --test test/price-fact-materializer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/analyze/src/price-fact-materializer.ts services/analyze/test/price-fact-materializer.test.ts
git commit -m "feat(analyze): current-price fact materializer (fra-23ou)"
```

---

## Task 2: Verify + close

- [ ] **Step 1: Run the full analyze suite**

Run (from `services/analyze`): `node --experimental-strip-types --test 'test/**/*.test.ts'`
Expected: PASS (existing + 3 new).

- [ ] **Step 2: Close the bead**

```bash
bd close fra-23ou --reason="materializePriceFact mints a listing-scoped method='vendor' price fact from a NormalizedQuote, with freshness_class mapped from delay_class and kept on the returned row (so the consumer's seal demands the right pricing disclosure). Unblocks fra-kikf."
```

- [ ] **Step 3: Note fra-kikf is now unblocked**

`fra-kikf` (price_target_range emitter) now has its data source. Leave the branch as-is unless directed otherwise.

---

## Self-Review notes

- **Spec coverage:** listing subject + vendor/point fact (Task 1) · delay→freshness map incl. unknown→stale (Task 1) · full FactRow with freshness intact (Task 1 assertion) · price metric resolution + throw (Task 1) · materializer-only scope (no emitter/disclosure/threading).
- **Type consistency:** `materializePriceFact`, `mapDelayClassToFreshness`, `FreshnessClass`, `DelayClass`, `NormalizedQuote` used identically.
- **Out of scope:** fra-kikf (emitter, disclosure block, quote-source threading, web range render).
