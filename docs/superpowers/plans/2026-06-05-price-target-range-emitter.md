# price_target_range Emitter + Disclosure Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seal a verifier-valid `price_target_range` block from analyst price targets + a current-price fact, emit the freshness disclosure the price fact demands, and render an inline range bar (bead `fra-kikf`; closes `fra-6syg`).

**Architecture:** A deterministic producer (`earnings_quality:price_targets`) materializes 3 issuer price-target facts (lean) + 1 listing current-price fact (full, via `fra-23ou`), builds the block with a `display` object (range-bar positions + formatted prices), and seals via `buildFactBackedSealInput` wrapped in a new reusable `withRequiredDisclosures` (which appends `compileDisclosurePolicy`'s pricing disclosure block). Quote comes from a `CurrentPriceSource` (issuer→listing→latest quote) threaded into the run deps.

**Tech Stack:** Node `--experimental-strip-types` (`services/analyze`, `services/snapshot`, `services/evidence`, `services/market`, `services/fundamentals`), Postgres, React 19 web.

---

## Background

- Run analyze tests from `services/analyze`: `node --experimental-strip-types --test test/<file>.test.ts`. Web from `web`: `TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test 'src/blocks/<f>.test.tsx'`; `npm run typecheck`; `npm run sync:schema`.
- **`compileDisclosurePolicy`** (`services/snapshot/src/disclosure-policy.ts`) takes `{snapshot_id, manifest:{subject_refs, source_ids, as_of, basis, normalization}, facts:[{fact_id, freshness_class?, source_id?}]}` and returns `{required_disclosures, required_disclosure_blocks: DisclosureBlockDraft[]}`. A `DisclosureBlockDraft` (`{id, kind:"disclosure", snapshot_id, data_ref:{kind:"disclosure_policy",id:"required"}, source_refs, as_of, disclosure_tier, items}`) is already a sealable `VerifierBlock` (no fact_refs).
- **Freshness split:** the current-price fact (full row from `materializePriceFact`) surfaces `freshness_class` → triggers `eod_pricing`/`delayed_pricing`; the price-target facts go **lean** (`toSealFactRow`) → no disclosure.
- `createFact` requires a `metric_id`, so `price_target_{low,mean,high}` must be seeded.

---

## Task 1: Seed price-target metrics

**Files:** Modify `db/seed/metrics.sql`

- [ ] **Step 1:** After the analyst rows (before `on conflict`), add (and a trailing comma on the prior `analyst_rating_strong_sell` line):

```sql
  ('analyst_rating_strong_sell', 'Strong Sell',    'count', 'point_in_time', 'neutral', 'vendor', 1, 'Count of analysts rating strong sell.'),

  -- Analyst price targets (vendor)
  ('price_target_low',           'Price Target Low',  'currency', 'point_in_time', 'neutral', 'vendor', 1, 'Lowest analyst price target.'),
  ('price_target_mean',          'Price Target Mean', 'currency', 'point_in_time', 'neutral', 'vendor', 1, 'Mean analyst price target.'),
  ('price_target_high',          'Price Target High', 'currency', 'point_in_time', 'neutral', 'vendor', 1, 'Highest analyst price target.')
on conflict (metric_key) do nothing;
```

- [ ] **Step 2:** Verify: `grep -c "price_target_" db/seed/metrics.sql` → `3`; `tail -1 db/seed/metrics.sql` → the `on conflict` line.
- [ ] **Step 3:** Commit: `git add db/seed/metrics.sql && git commit -m "feat(db): seed analyst price-target metrics (fra-kikf)"`

---

## Task 2: `withRequiredDisclosures` (novel infra, TDD)

**Files:** Modify `services/analyze/src/block-seal-input.ts`; Test `services/analyze/test/with-required-disclosures.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/analyze/test/with-required-disclosures.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { buildFactBackedSealInput, withRequiredDisclosures, type FactRow } from "../src/block-seal-input.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-0000000000aa";
const ISSUER = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const FACT = "fac00000-0000-4000-8000-000000000001";

function baseSeal(freshness?: string) {
  const row: FactRow & { freshness_class?: string } = {
    fact_id: FACT, source_id: SRC, unit: "currency", period_kind: "point",
    period_start: null, period_end: "2026-06-04", fiscal_year: null, fiscal_period: null,
    ...(freshness === undefined ? {} : { freshness_class: freshness }),
  };
  const block = {
    id: "b-1", kind: "price_target_range", snapshot_id: SNAP,
    data_ref: { kind: "price_target_range", id: "b-1" }, source_refs: [SRC], as_of: "2026-06-04T00:00:00.000Z",
    current_price_ref: FACT,
  };
  return buildFactBackedSealInput({ block, factRefs: [FACT], subjectRefs: [ISSUER], facts: [row] });
}

test("withRequiredDisclosures appends a pricing disclosure for an eod fact", () => {
  const sealed = withRequiredDisclosures(baseSeal("eod"));
  assert.equal(sealed.blocks.length, 2);
  const disclosure = sealed.blocks[1] as { kind: string; disclosure_tier: string; items: string[]; source_refs: string[] };
  assert.equal(disclosure.kind, "disclosure");
  assert.equal(disclosure.disclosure_tier, "eod");
  assert.ok(disclosure.items.some((i) => /end-of-day/i.test(i)));
  assert.ok(disclosure.source_refs.includes(SRC));
});

test("withRequiredDisclosures is a no-op when no fact surfaces freshness", () => {
  const seal = baseSeal();
  const sealed = withRequiredDisclosures(seal);
  assert.equal(sealed.blocks.length, 1);
  assert.equal(sealed, seal); // unchanged reference
});
```

- [ ] **Step 2: Run to verify it fails**

`node --experimental-strip-types --test test/with-required-disclosures.test.ts` → FAIL (`withRequiredDisclosures` not exported).

- [ ] **Step 3: Implement**

In `services/analyze/src/block-seal-input.ts`, add the import (after the existing snapshot imports):

```ts
import { compileDisclosurePolicy, type FreshnessClass } from "../../snapshot/src/disclosure-policy.ts";
```

Append at the end of the file:

```ts
// Append the disclosure blocks the seal's facts require (delayed/eod pricing,
// filing-time basis). compileDisclosurePolicy generates sealable disclosure
// blocks from the facts' freshness; the verifier re-derives the same requirement
// from the same facts, so coverage matches by construction. A no-op when no fact
// surfaces freshness (lean rows / non-market facts), so it is safe to wrap any
// seal. FactRow omits freshness_class (not a binding field), but materializers
// that mint market facts leave it on the row at runtime — read it here.
export function withRequiredDisclosures(seal: SnapshotSealInput): SnapshotSealInput {
  const compiled = compileDisclosurePolicy({
    snapshot_id: seal.snapshot_id,
    manifest: {
      subject_refs: seal.manifest.subject_refs,
      source_ids: seal.manifest.source_ids,
      as_of: seal.manifest.as_of,
      basis: seal.manifest.basis,
      normalization: seal.manifest.normalization,
    },
    facts: seal.facts.map((fact) => ({
      fact_id: fact.fact_id,
      source_id: fact.source_id ?? null,
      freshness_class: (fact as { freshness_class?: FreshnessClass }).freshness_class,
    })),
  });
  if (compiled.required_disclosure_blocks.length === 0) return seal;
  return {
    ...seal,
    blocks: [...seal.blocks, ...compiled.required_disclosure_blocks],
  };
}
```

- [ ] **Step 4: Run to verify it passes** → PASS (2 tests).
- [ ] **Step 5: Confirm no regression:** `node --experimental-strip-types --test test/metrics-comparison-snapshot.test.ts test/revenue-bars-snapshot.test.ts test/analyst-consensus-snapshot.test.ts` → PASS (those seals carry no freshness; unaffected).
- [ ] **Step 6: Commit**

```bash
git add services/analyze/src/block-seal-input.ts services/analyze/test/with-required-disclosures.test.ts
git commit -m "feat(analyze): withRequiredDisclosures seal wrapper (fra-kikf)"
```

---

## Task 3: `formatCurrency` (precise) + schema `display`

**Files:** Modify `services/analyze/src/block-format.ts`, `spec/finance_research_block_schema.json` (+ generated web copy)

- [ ] **Step 1: Add `formatCurrency`**

Append to `services/analyze/src/block-format.ts`:

```ts
// Precise currency for price points (e.g. "$214.50") — unlike formatCompactCurrency,
// which compacts large statement values (e.g. "$3.2B").
export function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
```

- [ ] **Step 2: Add the `display` object to the schema**

In `spec/finance_research_block_schema.json`, add a `PriceTargetPoint` def under `$defs` (next to other defs):

```json
"PriceTargetPoint": {
  "type": "object",
  "required": ["position", "format"],
  "properties": {
    "position": { "type": "number", "minimum": 0, "maximum": 1 },
    "format": { "type": "string" }
  },
  "additionalProperties": false
}
```

In `$defs.PriceTargetRange.allOf[1].properties`, add `display` (after `upside_ref`):

```json
"display": {
  "type": "object",
  "required": ["current", "low", "avg", "high"],
  "properties": {
    "current": { "$ref": "#/$defs/PriceTargetPoint" },
    "low": { "$ref": "#/$defs/PriceTargetPoint" },
    "avg": { "$ref": "#/$defs/PriceTargetPoint" },
    "high": { "$ref": "#/$defs/PriceTargetPoint" }
  },
  "additionalProperties": false
}
```

- [ ] **Step 3: Regenerate + verify**

`cd web && npm run sync:schema` then `python3 -c "import json; s=json.load(open('web/src/blocks/blockSchema.json')); assert 'PriceTargetPoint' in s['\$defs']; print('ok')"` (run from repo root, adjust path: `web/src/blocks/blockSchema.json`). Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add services/analyze/src/block-format.ts spec/finance_research_block_schema.json web/src/blocks/blockSchema.json
git commit -m "feat(spec): price_target_range display object + precise formatCurrency (fra-kikf)"
```

---

## Task 4: Price-target materializer (TDD)

**Files:** Create `services/analyze/src/price-target-materializer.ts`; Test `services/analyze/test/price-target-materializer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { materializePriceTargetFacts } from "../src/price-target-materializer.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { PriceTarget } from "../../fundamentals/src/analyst-consensus.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

const ISSUER: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const SRC = "00000000-0000-4000-a000-0000000000aa";
const CLOCK = () => new Date("2026-06-04T12:00:00.000Z");
const IDS: Record<string, string> = {
  price_target_low: "cccccccc-cccc-4ccc-8ccc-cccccccc0001",
  price_target_mean: "cccccccc-cccc-4ccc-8ccc-cccccccc0002",
  price_target_high: "cccccccc-cccc-4ccc-8ccc-cccccccc0003",
};

const priceTarget: PriceTarget = {
  currency: "USD", low: 170, mean: 220.5, median: 215, high: 280,
  contributor_count: 38, as_of: "2026-06-04T00:00:00.000Z", source_id: SRC,
};

function fakeDb() {
  const inserts: Array<Record<string, unknown>> = [];
  let n = 0;
  const db: QueryExecutor = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      if (/from metrics/i.test(text)) {
        const keys = (params?.[0] as string[]) ?? [];
        return { rows: keys.filter((k) => k in IDS).map((k) => ({ metric_key: k, metric_id: IDS[k] })) };
      }
      if (/insert into facts/i.test(text)) {
        const v = params ?? [];
        const row = { fact_id: `fac00000-0000-4000-8000-0000000000${(++n).toString(16).padStart(2, "0")}`,
          subject_kind: v[0], subject_id: v[1], metric_id: v[2], period_kind: v[3], period_start: v[4],
          period_end: v[5], fiscal_year: v[6], fiscal_period: v[7], value_num: v[8], value_text: v[9],
          unit: v[10], currency: v[11], scale: v[12], as_of: v[13], reported_at: v[14], observed_at: v[15],
          source_id: v[16], method: v[17], adjustment_basis: v[18], definition_version: v[19],
          verification_status: v[20], freshness_class: v[21], coverage_level: v[22], quality_flags: [],
          entitlement_channels: [], confidence: v[25], supersedes: null, superseded_by: null,
          invalidated_at: null, ingestion_batch_id: null, created_at: v[15], updated_at: v[15] };
        inserts.push(row);
        return { rows: [row] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, inserts };
}

test("materializePriceTargetFacts mints 3 issuer vendor facts and returns refs+values", async () => {
  const { db, inserts } = fakeDb();
  const result = await materializePriceTargetFacts(db, { issuer: ISSUER, priceTarget, clock: CLOCK });
  assert.equal(result.factRows.length, 3);
  assert.equal(result.currency, "USD");
  assert.equal(result.low.value, 170);
  assert.equal(result.mean.value, 220.5);
  assert.equal(result.high.value, 280);
  assert.equal(result.low.ref, inserts[0].fact_id);
  for (const row of inserts) {
    assert.equal(row.subject_kind, "issuer");
    assert.equal(row.method, "vendor");
    assert.equal(row.unit, "currency");
    assert.equal(row.currency, "USD");
    assert.equal(row.source_id, SRC);
  }
  // Lean rows: no freshness surfaced (analyst opinion, not a market price).
  assert.equal("freshness_class" in result.factRows[0], false);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**

Create `services/analyze/src/price-target-materializer.ts`:

```ts
// Mints the 3 issuer vendor facts an price_target_range block binds (low/mean/high)
// from the consensus envelope's price_target. Returned LEAN (via toSealFactRow):
// analyst targets are opinion, not a market price, so they surface no freshness
// disclosure (the current-price fact does that).

import { createFact, type FactInput } from "../../evidence/src/fact-repo.ts";
import { resolveMetricIds } from "../../evidence/src/metric-repo.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { PriceTarget } from "../../fundamentals/src/analyst-consensus.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import { toSealFactRow, type FactRow } from "./block-seal-input.ts";

const LOW_KEY = "price_target_low";
const MEAN_KEY = "price_target_mean";
const HIGH_KEY = "price_target_high";
const VENDOR_VERIFICATION_STATUS = "authoritative" as const;
const VENDOR_FRESHNESS_CLASS = "eod" as const;

export type MaterializedPriceTargets = {
  low: { ref: string; value: number };
  mean: { ref: string; value: number };
  high: { ref: string; value: number };
  currency: string;
  factRows: ReadonlyArray<FactRow>;
};

export async function materializePriceTargetFacts(
  db: QueryExecutor,
  input: { issuer: IssuerSubjectRef; priceTarget: PriceTarget; clock?: () => Date },
): Promise<MaterializedPriceTargets> {
  const clock = input.clock ?? (() => new Date());
  const observedAt = clock().toISOString();
  const pt = input.priceTarget;
  const periodEnd = pt.as_of.slice(0, 10);
  const metricIds = await resolveMetricIds(db, [LOW_KEY, MEAN_KEY, HIGH_KEY]);
  const factRows: FactRow[] = [];

  const mint = async (metricKey: string, value: number): Promise<string> => {
    const metricId = metricIds.get(metricKey);
    if (metricId === undefined) {
      throw new Error(`price-target-materializer: no metric_id registered for "${metricKey}"`);
    }
    const fact = await createFact(db, {
      subject_kind: "issuer",
      subject_id: input.issuer.id,
      metric_id: metricId,
      period_kind: "point",
      period_end: periodEnd,
      value_num: value,
      unit: "currency",
      currency: pt.currency,
      as_of: pt.as_of,
      observed_at: observedAt,
      source_id: pt.source_id,
      method: "vendor",
      verification_status: VENDOR_VERIFICATION_STATUS,
      freshness_class: VENDOR_FRESHNESS_CLASS,
      coverage_level: "full",
      confidence: 1,
    } satisfies FactInput);
    const lean = toSealFactRow(fact);
    factRows.push(lean);
    return lean.fact_id;
  };

  const lowRef = await mint(LOW_KEY, pt.low);
  const meanRef = await mint(MEAN_KEY, pt.mean);
  const highRef = await mint(HIGH_KEY, pt.high);

  return {
    low: { ref: lowRef, value: pt.low },
    mean: { ref: meanRef, value: pt.mean },
    high: { ref: highRef, value: pt.high },
    currency: pt.currency,
    factRows,
  };
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit:** `git add services/analyze/src/price-target-materializer.ts services/analyze/test/price-target-materializer.test.ts && git commit -m "feat(analyze): price-target fact materializer (fra-kikf)"`

---

## Task 5: Block builder (TDD)

**Files:** Create `services/analyze/src/price-target-range-block-builder.ts`; Test `services/analyze/test/price-target-range-block-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { buildPriceTargetRangeBlock } from "../src/price-target-range-block-builder.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-0000000000aa";
const BASE = { id: "price_targets-1", snapshot_id: SNAP, as_of: "2026-06-04T00:00:00.000Z", source_refs: [SRC] };

test("buildPriceTargetRangeBlock sets refs + range-bar positions + formatted prices", () => {
  const block = buildPriceTargetRangeBlock({
    currentPriceRef: "fac00000-0000-4000-8000-000000000004",
    current: 214.5,
    low: { ref: "fac00000-0000-4000-8000-000000000001", value: 170 },
    mean: { ref: "fac00000-0000-4000-8000-000000000002", value: 220 },
    high: { ref: "fac00000-0000-4000-8000-000000000003", value: 280 },
    currency: "USD",
    base: BASE,
  });
  assert.equal(block.kind, "price_target_range");
  assert.equal(block.data_ref.kind, "price_target_range");
  assert.equal(block.avg_ref, "fac00000-0000-4000-8000-000000000002");
  assert.equal(block.display.low.position, 0);
  assert.equal(block.display.high.position, 1);
  // avg = (220-170)/(280-170) = 0.4545…; current = (214.5-170)/110 = 0.4045…
  assert.ok(Math.abs(block.display.avg.position - 0.4545) < 0.01);
  assert.ok(Math.abs(block.display.current.position - 0.4045) < 0.01);
  assert.equal(block.display.low.format, "$170.00");
  assert.equal(block.display.current.format, "$214.50");
});

test("buildPriceTargetRangeBlock guards a zero span (all positions 0)", () => {
  const block = buildPriceTargetRangeBlock({
    currentPriceRef: "fac00000-0000-4000-8000-000000000004", current: 100,
    low: { ref: "a0000000-0000-4000-8000-000000000001", value: 100 },
    mean: { ref: "a0000000-0000-4000-8000-000000000002", value: 100 },
    high: { ref: "a0000000-0000-4000-8000-000000000003", value: 100 },
    currency: "USD", base: BASE,
  });
  assert.equal(block.display.avg.position, 0);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**

Create `services/analyze/src/price-target-range-block-builder.ts`:

```ts
// Assembles a price_target_range block: the current-price + low/mean/high refs
// plus a `display` object carrying each point's range-bar position (low=0,
// high=1, others interpolated) and pre-formatted price — the web renders the bar
// from these, staying a dumb renderer.

import { formatCurrency } from "./block-format.ts";
import type { UUID } from "../../fundamentals/src/subject-ref.ts";

export type PriceTargetPoint = { position: number; format: string };

export type PriceTargetRangeDisplay = {
  current: PriceTargetPoint;
  low: PriceTargetPoint;
  avg: PriceTargetPoint;
  high: PriceTargetPoint;
};

export type PriceTargetRangeBlockBase = {
  id: string;
  snapshot_id: UUID;
  as_of: string;
  source_refs: ReadonlyArray<UUID>;
  title?: string;
};

export type PriceTargetRangeBlock = {
  id: string;
  kind: "price_target_range";
  snapshot_id: UUID;
  data_ref: { kind: string; id: string; params?: Readonly<Record<string, unknown>> };
  source_refs: ReadonlyArray<UUID>;
  as_of: string;
  title?: string;
  current_price_ref: UUID;
  low_ref: UUID;
  avg_ref: UUID;
  high_ref: UUID;
  display: PriceTargetRangeDisplay;
};

export function buildPriceTargetRangeBlock(input: {
  currentPriceRef: UUID;
  current: number;
  low: { ref: UUID; value: number };
  mean: { ref: UUID; value: number };
  high: { ref: UUID; value: number };
  currency: string;
  base: PriceTargetRangeBlockBase;
}): PriceTargetRangeBlock {
  const { low, mean, high, current, currency, base } = input;
  const span = high.value - low.value;
  const position = (value: number): number => (span > 0 ? clamp01((value - low.value) / span) : 0);

  return {
    id: base.id,
    kind: "price_target_range",
    snapshot_id: base.snapshot_id,
    data_ref: { kind: "price_target_range", id: base.id },
    source_refs: base.source_refs,
    as_of: base.as_of,
    ...(base.title === undefined ? {} : { title: base.title }),
    current_price_ref: input.currentPriceRef,
    low_ref: low.ref,
    avg_ref: mean.ref,
    high_ref: high.ref,
    display: {
      current: { position: position(current), format: formatCurrency(current, currency) },
      low: { position: 0, format: formatCurrency(low.value, currency) },
      avg: { position: position(mean.value), format: formatCurrency(mean.value, currency) },
      high: { position: 1, format: formatCurrency(high.value, currency) },
    },
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit:** `git add services/analyze/src/price-target-range-block-builder.ts services/analyze/test/price-target-range-block-builder.test.ts && git commit -m "feat(analyze): price_target_range block builder (fra-kikf)"`

---

## Task 6: Snapshot delegate (TDD)

**Files:** Create `services/analyze/src/price-target-range-snapshot.ts`; Test `services/analyze/test/price-target-range-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { buildPriceTargetRangeBlock } from "../src/price-target-range-block-builder.ts";
import { buildPriceTargetRangeSealInput } from "../src/price-target-range-snapshot.ts";
import type { FactRow } from "../src/block-seal-input.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-0000000000aa";
const PRIMARY = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" } as const;
const LISTING = { kind: "listing", id: "55555555-5555-4555-a555-555555555555" } as const;
const REFS = { low: "fac00000-0000-4000-8000-000000000001", mean: "fac00000-0000-4000-8000-000000000002", high: "fac00000-0000-4000-8000-000000000003", price: "fac00000-0000-4000-8000-000000000004" };

function block() {
  return buildPriceTargetRangeBlock({
    currentPriceRef: REFS.price, current: 214.5,
    low: { ref: REFS.low, value: 170 }, mean: { ref: REFS.mean, value: 220 }, high: { ref: REFS.high, value: 280 },
    currency: "USD", base: { id: "price_targets-1", snapshot_id: SNAP, as_of: "2026-06-04T00:00:00.000Z", source_refs: [SRC] },
  });
}
function lean(id: string): FactRow {
  return { fact_id: id, source_id: SRC, unit: "currency", period_kind: "point", period_start: null, period_end: "2026-06-04", fiscal_year: null, fiscal_period: null };
}
function priceRow(): FactRow & { freshness_class: string } {
  return { ...lean(REFS.price), freshness_class: "eod" };
}

test("buildPriceTargetRangeSealInput binds 4 facts + both subjects + appends the eod disclosure", () => {
  const seal = buildPriceTargetRangeSealInput({
    block: block(),
    facts: [lean(REFS.low), lean(REFS.mean), lean(REFS.high), priceRow()],
    primary: PRIMARY, listing: LISTING,
  });
  assert.deepEqual(new Set(seal.manifest.fact_refs), new Set([REFS.price, REFS.low, REFS.mean, REFS.high]));
  assert.deepEqual(new Set(seal.manifest.subject_refs.map((s) => s.id)), new Set([PRIMARY.id, LISTING.id]));
  assert.equal(seal.blocks.length, 2);
  assert.equal((seal.blocks[1] as { kind: string }).kind, "disclosure");
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**

Create `services/analyze/src/price-target-range-snapshot.ts`:

```ts
// Seals a price_target_range block: binds the current-price + low/mean/high facts
// via the shared core, then wraps with withRequiredDisclosures so the current-price
// fact's freshness gets its pricing disclosure block.

import { buildFactBackedSealInput, withRequiredDisclosures, type FactRow } from "./block-seal-input.ts";
import type { PriceTargetRangeBlock } from "./price-target-range-block-builder.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";

export function buildPriceTargetRangeSealInput(input: {
  block: PriceTargetRangeBlock;
  facts: ReadonlyArray<FactRow>;
  primary: IssuerSubjectRef;
  listing: { kind: string; id: string };
  modelVersion?: string | null;
}): SnapshotSealInput {
  const seal = buildFactBackedSealInput({
    block: input.block,
    factRefs: [
      input.block.current_price_ref,
      input.block.low_ref,
      input.block.avg_ref,
      input.block.high_ref,
    ],
    subjectRefs: [
      { kind: input.primary.kind, id: input.primary.id },
      { kind: input.listing.kind, id: input.listing.id },
    ],
    facts: input.facts,
    ...(input.modelVersion === undefined ? {} : { modelVersion: input.modelVersion }),
  });
  return withRequiredDisclosures(seal);
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit:** `git add services/analyze/src/price-target-range-snapshot.ts services/analyze/test/price-target-range-snapshot.test.ts && git commit -m "feat(analyze): price_target_range seal delegate + disclosure (fra-kikf)"`

---

## Task 7: Current-price source (TDD)

**Files:** Create `services/analyze/src/current-price-source.ts`; Test `services/analyze/test/current-price-source.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { createCurrentPriceSource } from "../src/current-price-source.ts";

const LISTING = { kind: "listing", id: "55555555-5555-4555-a555-555555555555" } as const;
const QUOTE = { listing: LISTING, price: 214.5, currency: "USD", as_of: "2026-06-04T19:55:00.000Z", delay_class: "eod", source_id: "00000000-0000-4000-a000-0000000000aa" };

function profiles(exchange: unknown) {
  return { async find() { return exchange === null ? null : { exchanges: [{ listing: LISTING }] }; } } as never;
}

test("createCurrentPriceSource resolves issuer -> primary listing -> latest quote", async () => {
  const cache = { async findLatestQuote() { return { quote: QUOTE }; } } as never;
  const source = createCurrentPriceSource(profiles({}), cache);
  const quote = await source.findByIssuer("22222222-2222-4222-a222-222222222222");
  assert.equal(quote?.price, 214.5);
});

test("createCurrentPriceSource returns null when there is no listing or no quote", async () => {
  const noQuote = { async findLatestQuote() { return null; } } as never;
  assert.equal(await createCurrentPriceSource(profiles({}), noQuote).findByIssuer("x"), null);
  const anyCache = { async findLatestQuote() { return { quote: QUOTE }; } } as never;
  assert.equal(await createCurrentPriceSource(profiles(null), anyCache).findByIssuer("x"), null);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**

Create `services/analyze/src/current-price-source.ts`:

```ts
// Resolves an issuer's current-price quote: issuer -> primary listing (profile's
// first exchange) -> the market cache's latest quote. Bridges the fundamentals
// profile repo and the market cache repo so the analyze run path takes one dep.

import type { IssuerProfileRepository } from "../../fundamentals/src/issuer-repository.ts";
import type { MarketCacheRepository } from "../../market/src/cache-repository.ts";
import type { NormalizedQuote } from "../../market/src/quote.ts";

export type CurrentPriceSource = {
  findByIssuer(issuerId: string): Promise<NormalizedQuote | null>;
};

export function createCurrentPriceSource(
  profiles: IssuerProfileRepository,
  cache: MarketCacheRepository,
): CurrentPriceSource {
  return {
    async findByIssuer(issuerId: string): Promise<NormalizedQuote | null> {
      const profile = await profiles.find(issuerId);
      const listing = profile?.exchanges[0]?.listing;
      if (!listing) return null;
      const cached = await cache.findLatestQuote(listing);
      return cached?.quote ?? null;
    },
  };
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit:** `git add services/analyze/src/current-price-source.ts services/analyze/test/current-price-source.test.ts && git commit -m "feat(analyze): current-price source (issuer->listing->quote) (fra-kikf)"`

---

## Task 8: Emitter (TDD — the key verifier proof)

**Files:** Create `services/analyze/src/price-target-range-emitter.ts`; Test `services/analyze/test/price-target-range-emitter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { emitPriceTargetRangeBlock } from "../src/price-target-range-emitter.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { ConsensusRepository } from "../../fundamentals/src/consensus-repository.ts";
import type { AnalystConsensusEnvelope } from "../../fundamentals/src/analyst-consensus.ts";
import type { CurrentPriceSource } from "../src/current-price-source.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC_T = "00000000-0000-4000-a000-0000000000aa";
const SRC_P = "00000000-0000-4000-a000-0000000000bb";
const PRIMARY: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const LISTING = { kind: "listing", id: "55555555-5555-4555-a555-555555555555" } as const;
const CLOCK = () => new Date("2026-06-04T12:00:00.000Z");
const INPUT = { primary: PRIMARY, snapshotId: SNAP, blockId: "price_targets-1", asOf: "2026-06-04T00:00:00.000Z" };

const METRIC_IDS: Record<string, string> = {
  price_target_low: "cccccccc-cccc-4ccc-8ccc-cccccccc0001",
  price_target_mean: "cccccccc-cccc-4ccc-8ccc-cccccccc0002",
  price_target_high: "cccccccc-cccc-4ccc-8ccc-cccccccc0003",
  price: "cccccccc-cccc-4ccc-8ccc-cccccccc0004",
};

function envelope(): AnalystConsensusEnvelope {
  return {
    subject: PRIMARY, family: "analyst_consensus", analyst_count: 41, as_of: "2026-06-04T00:00:00.000Z",
    rating_distribution: null,
    price_target: { currency: "USD", low: 170, mean: 220.5, median: 215, high: 280, contributor_count: 38, as_of: "2026-06-04T00:00:00.000Z", source_id: SRC_T },
    estimates: [], coverage_warnings: [],
  };
}
function consensusRepo(env: AnalystConsensusEnvelope | null): ConsensusRepository { return { async find() { return env; } }; }
function priceSource(quote: unknown): CurrentPriceSource { return { async findByIssuer() { return quote as never; } }; }
const QUOTE = { listing: LISTING, price: 214.5, prev_close: 210, change_abs: 4.5, change_pct: 0.02, session_state: "regular", as_of: "2026-06-04T19:55:00.000Z", delay_class: "eod", currency: "USD", source_id: SRC_P };

function fakeDb(): QueryExecutor {
  let n = 0;
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      if (/from metrics/i.test(text)) {
        const keys = (params?.[0] as string[]) ?? [];
        return { rows: keys.filter((k) => k in METRIC_IDS).map((k) => ({ metric_key: k, metric_id: METRIC_IDS[k] })) };
      }
      if (/insert into facts/i.test(text)) {
        const v = params ?? [];
        return { rows: [{ fact_id: `fac00000-0000-4000-8000-0000000000${(++n).toString(16).padStart(2, "0")}`,
          subject_kind: v[0], subject_id: v[1], metric_id: v[2], period_kind: v[3], period_start: v[4], period_end: v[5],
          fiscal_year: v[6], fiscal_period: v[7], value_num: v[8], value_text: v[9], unit: v[10], currency: v[11],
          scale: v[12], as_of: v[13], reported_at: v[14], observed_at: v[15], source_id: v[16], method: v[17],
          adjustment_basis: v[18], definition_version: v[19], verification_status: v[20], freshness_class: v[21],
          coverage_level: v[22], quality_flags: [], entitlement_channels: [], confidence: v[25], supersedes: null,
          superseded_by: null, invalidated_at: null, ingestion_batch_id: null, created_at: v[15], updated_at: v[15] }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

test("emitPriceTargetRangeBlock seals a price_target_range + disclosure that passes the verifier", async () => {
  const seal = await emitPriceTargetRangeBlock({ db: fakeDb(), consensus: consensusRepo(envelope()), price: priceSource(QUOTE), clock: CLOCK }, INPUT);
  assert.ok(seal);
  assert.equal(seal.blocks[0].kind, "price_target_range");
  assert.equal(seal.blocks.length, 2);
  assert.equal((seal.blocks[1] as { kind: string }).kind, "disclosure");
  assert.equal(seal.manifest.fact_refs.length, 4);
  const verification = await verifySnapshotSeal(seal);
  assert.equal(verification.ok, true, verification.ok ? "" : JSON.stringify(verification.failures, null, 2));
});

test("emitPriceTargetRangeBlock returns null when no price_target or no quote", async () => {
  const noTarget = { ...envelope(), price_target: null };
  assert.equal(await emitPriceTargetRangeBlock({ db: fakeDb(), consensus: consensusRepo(noTarget), price: priceSource(QUOTE), clock: CLOCK }, INPUT), null);
  assert.equal(await emitPriceTargetRangeBlock({ db: fakeDb(), consensus: consensusRepo(envelope()), price: priceSource(null), clock: CLOCK }, INPUT), null);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**

Create `services/analyze/src/price-target-range-emitter.ts`:

```ts
// The earnings_quality playbook's deterministic emitter for the price_targets
// section: fetch the consensus price_target + the issuer's current quote,
// materialize the target facts (lean) + current-price fact (full), build the
// block, and seal it (with the pricing disclosure the price fact requires).
// Returns null (section omitted) when there is no price_target or no quote.

import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { ConsensusRepository } from "../../fundamentals/src/consensus-repository.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import { materializePriceTargetFacts } from "./price-target-materializer.ts";
import { materializePriceFact } from "./price-fact-materializer.ts";
import { buildPriceTargetRangeBlock } from "./price-target-range-block-builder.ts";
import { buildPriceTargetRangeSealInput } from "./price-target-range-snapshot.ts";
import type { CurrentPriceSource } from "./current-price-source.ts";
import type { FactRow } from "./block-seal-input.ts";

export type PriceTargetRangeEmitterDeps = {
  db: QueryExecutor;
  consensus: ConsensusRepository;
  price: CurrentPriceSource;
  clock?: () => Date;
};

export type PriceTargetRangeEmitInput = {
  primary: IssuerSubjectRef;
  snapshotId: UUID;
  blockId: string;
  asOf: string;
  title?: string;
};

export async function emitPriceTargetRangeBlock(
  deps: PriceTargetRangeEmitterDeps,
  input: PriceTargetRangeEmitInput,
): Promise<SnapshotSealInput | null> {
  const envelope = await deps.consensus.find(input.primary.id);
  if (envelope === null || envelope.price_target === null) return null;
  const quote = await deps.price.findByIssuer(input.primary.id);
  if (quote === null) return null;

  const targets = await materializePriceTargetFacts(deps.db, {
    issuer: input.primary,
    priceTarget: envelope.price_target,
    clock: deps.clock,
  });
  const priceFact = await materializePriceFact(deps.db, { quote, clock: deps.clock });

  const facts: FactRow[] = [...targets.factRows, priceFact];
  const block = buildPriceTargetRangeBlock({
    currentPriceRef: priceFact.fact_id,
    current: quote.price,
    low: targets.low,
    mean: targets.mean,
    high: targets.high,
    currency: targets.currency,
    base: {
      id: input.blockId,
      snapshot_id: input.snapshotId,
      as_of: input.asOf,
      source_refs: distinct(facts.map((fact) => fact.source_id)),
      ...(input.title === undefined ? {} : { title: input.title }),
    },
  });

  return buildPriceTargetRangeSealInput({ block, facts, primary: input.primary, listing: quote.listing });
}

function distinct(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}
```

(Note: `materializePriceFact` returns the FULL row; `FactRow` here is the lean type, and the full row is structurally assignable — its extra `freshness_class` rides along at runtime for `withRequiredDisclosures`.)

- [ ] **Step 4: Run → PASS** (the verifier accepts the 2-block seal; the disclosure covers the eod price fact).
- [ ] **Step 5: Commit:** `git add services/analyze/src/price-target-range-emitter.ts services/analyze/test/price-target-range-emitter.test.ts && git commit -m "feat(analyze): price_target_range emitter (fra-kikf)"`

---

## Task 9: Register producer + playbook section

**Files:** Modify `services/analyze/src/section-producers.ts`, `playbook.ts`, `test/section-producers.test.ts`

- [ ] **Step 1: Add the registry test**

Append to `services/analyze/test/section-producers.test.ts`:

```ts
test("the earnings_quality price_targets section resolves to a producer", () => {
  assert.notEqual(lookupSectionProducer("earnings_quality", "price_targets"), undefined);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Register**

In `services/analyze/src/section-producers.ts`, add imports:

```ts
import type { CurrentPriceSource } from "./current-price-source.ts";
import { emitPriceTargetRangeBlock } from "./price-target-range-emitter.ts";
```

Add `price` to `SectionProducerDeps`:

```ts
export type SectionProducerDeps = {
  db: QueryExecutor;
  peers: PeerSetResolver;
  stats: StatsRepository;
  consensus?: ConsensusRepository;
  price?: CurrentPriceSource;
  clock?: () => Date;
};
```

Add the producer (after `ANALYST_CONSENSUS_PRODUCER`):

```ts
const PRICE_TARGET_RANGE_PRODUCER: SectionProducer = (deps, ctx) => {
  if (deps.consensus === undefined || deps.price === undefined) return Promise.resolve(null);
  return emitPriceTargetRangeBlock(
    { db: deps.db, consensus: deps.consensus, price: deps.price, clock: deps.clock },
    {
      primary: ctx.primary,
      snapshotId: ctx.snapshotId,
      blockId: sectionBlockId("price_targets"),
      asOf: ctx.asOf,
    },
  );
};
```

Add the registry entry:

```ts
  ["earnings_quality:analyst_overview", ANALYST_CONSENSUS_PRODUCER],
  ["earnings_quality:price_targets", PRICE_TARGET_RANGE_PRODUCER],
```

- [ ] **Step 4: Add the playbook section**

In `services/analyze/src/playbook.ts`, after the `analyst_overview` line in `earnings_quality`:

```ts
      section("analyst_overview", "Analyst overview", false, "section"),
      section("price_targets", "Price targets", false, "section"),
```

- [ ] **Step 5: Update `playbook.test.ts`** — add `"price_targets"` after `"analyst_overview"` in the `earnings_quality` section-id assertion array.

- [ ] **Step 6: Run** `node --experimental-strip-types --test test/section-producers.test.ts test/section-runner.test.ts test/playbook.test.ts` → PASS.

- [ ] **Step 7: Commit:** `git add services/analyze/src/section-producers.ts services/analyze/src/playbook.ts services/analyze/test/section-producers.test.ts services/analyze/test/playbook.test.ts && git commit -m "feat(analyze): register price_target_range producer (fra-kikf)"`

---

## Task 10: dev-api wiring

**Files:** Modify `services/dev-api/src/local-runtime.ts`

- [ ] **Step 1: Thread the price source**

Add imports:

```ts
import { createCurrentPriceSource } from "../../analyze/src/current-price-source.ts";
import { createPostgresIssuerProfileRepository } from "../../fundamentals/src/issuer-repository.ts";
import { createPostgresMarketCacheRepository } from "../../market/src/cache-repository.ts";
```

In `analyzeSectionDeps`, after `consensus`:

```ts
  const price = createCurrentPriceSource(
    createPostgresIssuerProfileRepository(db),
    createPostgresMarketCacheRepository(db),
  );
  return { db, peers: createSqlPeerSetResolver(db), stats, consensus: consensusRepositoryFromEnv(db), price };
```

- [ ] **Step 2: Run** `cd services/dev-api && node --experimental-strip-types --test 'test/**/*.test.ts'` → PASS (price source present but no quote data in tests → section omitted; existing runs unaffected).

- [ ] **Step 3: Commit:** `git add services/dev-api/src/local-runtime.ts && git commit -m "feat(dev-api): thread current-price source into analyze deps (fra-kikf)"`

---

## Task 11: Web range bar (TDD)

**Files:** Modify `web/src/blocks/types.ts`, `fixtures.ts`, `PriceTargetRange.tsx`; Create `web/src/blocks/PriceTargetRange.test.tsx`

- [ ] **Step 1: Extend the type**

In `web/src/blocks/types.ts`, replace `PriceTargetRangeBlock`:

```ts
export type PriceTargetPoint = { position: number; format: string }

export type PriceTargetRangeDisplay = {
  current: PriceTargetPoint
  low: PriceTargetPoint
  avg: PriceTargetPoint
  high: PriceTargetPoint
}

export type PriceTargetRangeBlock = BaseBlock & {
  kind: 'price_target_range'
  current_price_ref: string
  low_ref: string
  avg_ref: string
  high_ref: string
  upside_ref?: string
  display?: PriceTargetRangeDisplay
}
```

- [ ] **Step 2: Add `display` to the fixture**

In `web/src/blocks/fixtures.ts`, add to `priceTargetRangeFixture` (after `high_ref`, drop `upside_ref` or keep — keep it):

```ts
  upside_ref: 'eeeeeeee-1111-4111-9111-eeeeeeeeeeee',
  display: {
    current: { position: 0.4045, format: '$214.50' },
    low: { position: 0, format: '$170.00' },
    avg: { position: 0.4545, format: '$220.00' },
    high: { position: 1, format: '$280.00' },
  },
```

- [ ] **Step 3: Write the failing test**

Create `web/src/blocks/PriceTargetRange.test.tsx`:

```tsx
import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { PriceTargetRange } from './PriceTargetRange.tsx'
import { priceTargetRangeFixture } from './fixtures.ts'
import { validateBlock } from './BlockValidator.ts'
import type { PriceTargetRangeBlock } from './types.ts'

test('the price_target_range fixture validates against the schema (display allowed)', () => {
  const result = validateBlock(priceTargetRangeFixture)
  assert.equal(result.valid, true, result.valid ? '' : JSON.stringify(result.errors, null, 2))
})

test('PriceTargetRange renders a range bar with markers and formatted prices', () => {
  const html = renderToStaticMarkup(<PriceTargetRange block={priceTargetRangeFixture} />)
  assert.match(html, /\$170\.00/)
  assert.match(html, /\$280\.00/)
  assert.match(html, /\$214\.50/)
  // avg marker positioned from display.avg.position (45.45%)
  assert.match(html, /left:45\.45/)
  assert.match(html, /price-target-range-.*-avg-marker/)
})

test('PriceTargetRange falls back to the em-dash grid when display is absent', () => {
  const block: PriceTargetRangeBlock = {
    id: 'ptr-empty', kind: 'price_target_range', snapshot_id: '11111111-1111-4111-9111-111111111111',
    data_ref: { kind: 'price_target_range', id: 'ptr-empty' }, source_refs: [], as_of: '2026-06-04T00:00:00.000Z',
    current_price_ref: 'eeeeeeee-1111-4111-9111-aaaaaaaaaaaa', low_ref: 'eeeeeeee-1111-4111-9111-bbbbbbbbbbbb',
    avg_ref: 'eeeeeeee-1111-4111-9111-cccccccccccc', high_ref: 'eeeeeeee-1111-4111-9111-dddddddddddd',
  }
  const html = renderToStaticMarkup(<PriceTargetRange block={block} />)
  assert.match(html, /—/)
})
```

- [ ] **Step 4: Run → FAIL** (stub renders em-dashes; no markers).

- [ ] **Step 5: Implement**

Replace `web/src/blocks/PriceTargetRange.tsx`:

```tsx
import type { ReactElement } from 'react'
import type { PriceTargetRangeBlock, PriceTargetRangeDisplay } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { LabelValueCell } from './LabelValueCell.tsx'

type PriceTargetRangeProps = { block: PriceTargetRangeBlock }

export function PriceTargetRange({ block }: PriceTargetRangeProps): ReactElement {
  return (
    <ChartCard testId={`block-price-target-range-${block.id}`} blockKind="price_target_range" title={block.title}>
      {block.display ? (
        <RangeBar blockId={block.id} display={block.display} />
      ) : (
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <StubCell blockId={block.id} field="current" label="Current" valueRef={block.current_price_ref} />
          <StubCell blockId={block.id} field="low" label="Low" valueRef={block.low_ref} />
          <StubCell blockId={block.id} field="avg" label="Avg" valueRef={block.avg_ref} />
          <StubCell blockId={block.id} field="high" label="High" valueRef={block.high_ref} />
        </dl>
      )}
    </ChartCard>
  )
}

function RangeBar({ blockId, display }: { blockId: string; display: PriceTargetRangeDisplay }): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
        <PriceRow label="Low" value={display.low.format} />
        <PriceRow label="Avg" value={display.avg.format} emphasis />
        <PriceRow label="High" value={display.high.format} />
        <PriceRow label="Current" value={display.current.format} />
      </dl>
      <div className="relative h-2 rounded bg-surface-2">
        <span
          aria-hidden="true"
          data-testid={`block-price-target-range-${blockId}-avg-marker`}
          className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-accent"
          style={{ left: `${display.avg.position * 100}%` }}
        />
        <span
          aria-hidden="true"
          data-testid={`block-price-target-range-${blockId}-current-marker`}
          className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-fg"
          style={{ left: `${display.current.position * 100}%` }}
        />
      </div>
    </div>
  )
}

function PriceRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={emphasis ? 'num font-medium text-fg' : 'num text-fg'}>{value}</dd>
    </div>
  )
}

function StubCell({ blockId, field, label, valueRef }: { blockId: string; field: string; label: string; valueRef: string }): ReactElement {
  return (
    <LabelValueCell label={label} testId={`block-price-target-range-${blockId}-${field}`} dataAttrs={{ 'data-value-ref': valueRef }} emphasis>
      —
    </LabelValueCell>
  )
}
```

- [ ] **Step 6: Run → PASS;** then `npm run typecheck` → PASS.
- [ ] **Step 7: Commit:** `git add web/src/blocks/types.ts web/src/blocks/fixtures.ts web/src/blocks/PriceTargetRange.tsx web/src/blocks/PriceTargetRange.test.tsx && git commit -m "feat(web): render price_target_range range bar (fra-kikf)"`

---

## Task 12: Final verification + close the epic

- [ ] **Step 1: Full suites**

```
cd services/analyze && node --experimental-strip-types --test 'test/**/*.test.ts'
cd ../dev-api && node --experimental-strip-types --test 'test/**/*.test.ts'
cd ../../web && npm test && npm run typecheck
```
Expected: all PASS.

- [ ] **Step 2: Close `fra-kikf` and `fra-6syg`**

```bash
bd close fra-kikf --reason="price_target_range emitter: materializes 3 issuer price-target facts + 1 listing current-price fact, seals a [price_target_range, disclosure] snapshot via the new reusable withRequiredDisclosures wrapper (verifySnapshotSeal ok), renders an inline range bar. earnings_quality:price_targets."
bd close fra-6syg --reason="All three stub blocks now have real deterministic pipelines: revenue_bars (fra-ef24), analyst_consensus, price_target_range (fra-kikf). Epic complete."
```

- [ ] **Step 3: Commit beads + finish**

Commit the beads state. Then use **superpowers:finishing-a-development-branch** to complete the work (the branch carries the full fra-tcav→fra-6syg→fra-q840→fra-23ou→fra-kikf chain).

---

## Self-Review notes

- **Spec coverage:** seed (T1) · withRequiredDisclosures + no-op (T2) · formatCurrency + display schema (T3) · price-target lean materializer (T4) · builder positions/formats + zero-span guard (T5) · snapshot delegate + disclosure (T6) · current-price source (T7) · emitter + verifySnapshotSeal-with-disclosure + null paths (T8) · producer/playbook + `price?` dep (T9) · dev-api wiring (T10) · web range bar + stub fallback + validateBlock (T11) · close epic (T12).
- **Freshness split:** price-target facts lean (no disclosure); current-price fact full (eod disclosure) — verified by T8.
- **Type consistency:** `withRequiredDisclosures`, `MaterializedPriceTargets`, `PriceTargetRangeBlock`/`PriceTargetPoint`/`PriceTargetRangeDisplay`, `CurrentPriceSource`, `buildPriceTargetRangeSealInput`, `SectionProducerDeps.price` consistent across tasks.
- **Out of scope:** `upside_ref` (v1 omitted).
