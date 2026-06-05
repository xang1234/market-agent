# Analyst-Consensus Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `AnalystConsensusEnvelope` into a sealed, verifier-valid `analyst_consensus` block rendering a real rating distribution (bead `fra-6syg`, scoped; `price_target_range` deferred).

**Architecture:** A deterministic section producer (`earnings_quality:analyst_overview`) fetches the consensus envelope via a `ConsensusRepository` dep, materializes 6 vendor facts (analyst_count + 5 rating counts) via `createFact`, builds the block (with a `count` display field per bucket), and seals through the shared `buildFactBackedSealInput`. The web renders an inline stacked bar.

**Tech Stack:** Node `--experimental-strip-types` (`services/analyze`, `services/evidence`, `services/snapshot`), Postgres `facts`/`metrics`, React 19 web.

---

## Background the engineer needs

- **Run analyze tests** from `services/analyze`: `node --experimental-strip-types --test test/<file>.test.ts` (suite: `'test/**/*.test.ts'`). No tsconfig — runtime tests are the gate.
- **Run dev-api tests** from `services/dev-api`: `node --experimental-strip-types --test 'test/**/*.test.ts'`.
- **Run web tests** from `web`: `TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test 'src/blocks/<file>.test.tsx'`; typecheck `npm run typecheck`; schema sync `npm run sync:schema`.
- **`createFact`** (`services/evidence/src/fact-repo.ts`) inserts a fact and returns a `FactRow` carrying `fact_id, source_id, unit, period_kind, period_end, fiscal_year, fiscal_period, …` — exactly what `buildFactBackedSealInput` needs, so the materializer's returned rows feed the seal with no load query.
- **`buildFactBackedSealInput`** (`services/analyze/src/block-seal-input.ts`, from the revenue_bars work) owns the manifest + fact_binding + dedup. For `point` facts the binding requires `unit, period_kind, period_end` — all present on minted rows.
- **The verifier already handles `analyst_consensus`** (extracts `analyst_count_ref` + `distribution[].count_ref`); no verifier changes.
- **Rating order/labels:** `ANALYST_RATINGS = [strong_buy, buy, hold, sell, strong_sell]` (exported from `services/fundamentals/src/analyst-consensus.ts`). The existing web fixture labels them `Strong Buy/Buy/Hold/Sell/Strong Sell` — match that casing.

---

## File Structure

**Create (`services/analyze/src`):** `analyst-consensus-materializer.ts`, `analyst-consensus-block-builder.ts`, `analyst-consensus-snapshot.ts`, `analyst-consensus-emitter.ts` (+ 4 test files).
**Modify:** `db/seed/metrics.sql` · `spec/finance_research_block_schema.json` (+ `web/src/blocks/blockSchema.json`) · `services/analyze/src/section-producers.ts` · `services/analyze/src/playbook.ts` · `services/dev-api/src/local-runtime.ts` · `web/src/blocks/AnalystConsensus.tsx` + `types.ts` + `fixtures.ts` (+ new `AnalystConsensus.test.tsx`).

---

## Task 1: Metrics seed

**Files:** Modify `db/seed/metrics.sql`

- [ ] **Step 1: Add the 6 analyst metric rows**

In `db/seed/metrics.sql`, the file ends with the `eps_growth_yoy` row (no trailing comma) then `on conflict (metric_key) do nothing;`. Add a comma after that row and insert the analyst rows before the `on conflict` line:

```sql
  ('eps_growth_yoy',        'EPS Growth (YoY)',           'percent',  'yoy',          'higher_is_better', 'derived', 1, 'Year-over-year percentage change in diluted EPS.'),

  -- Analyst consensus (vendor)
  ('analyst_count',              'Analyst Count',  'count', 'point_in_time', 'neutral', 'vendor', 1, 'Number of analysts providing coverage.'),
  ('analyst_rating_strong_buy',  'Strong Buy',     'count', 'point_in_time', 'neutral', 'vendor', 1, 'Count of analysts rating strong buy.'),
  ('analyst_rating_buy',         'Buy',            'count', 'point_in_time', 'neutral', 'vendor', 1, 'Count of analysts rating buy.'),
  ('analyst_rating_hold',        'Hold',           'count', 'point_in_time', 'neutral', 'vendor', 1, 'Count of analysts rating hold.'),
  ('analyst_rating_sell',        'Sell',           'count', 'point_in_time', 'neutral', 'vendor', 1, 'Count of analysts rating sell.'),
  ('analyst_rating_strong_sell', 'Strong Sell',    'count', 'point_in_time', 'neutral', 'vendor', 1, 'Count of analysts rating strong sell.')
on conflict (metric_key) do nothing;
```

- [ ] **Step 2: Verify the file still parses as one INSERT**

Run (from repo root):
```
grep -c "analyst_rating" db/seed/metrics.sql
tail -1 db/seed/metrics.sql
```
Expected: `5` analyst_rating rows; last line `on conflict (metric_key) do nothing;`.

- [ ] **Step 3: Commit**

```bash
git add db/seed/metrics.sql
git commit -m "feat(db): seed analyst-consensus vendor metrics (fra-6syg)"
```

---

## Task 2: Schema — `count` on the distribution bucket

**Files:** Modify `spec/finance_research_block_schema.json`; generate `web/src/blocks/blockSchema.json`

- [ ] **Step 1: Add the field**

In `spec/finance_research_block_schema.json`, find `$defs.AnalystConsensus` → the `distribution.items.properties` (currently `bucket`, `count_ref`, with `additionalProperties: false`). Add `count`:

```json
"properties": {
  "bucket": { "type": "string" },
  "count_ref": { "$ref": "#/$defs/UUID" },
  "count": { "type": "integer", "minimum": 0 }
},
"additionalProperties": false
```

- [ ] **Step 2: Regenerate the web copy + verify**

```
cd web && npm run sync:schema
grep -c '"count"' src/blocks/blockSchema.json
```
Expected: at least `1`.

- [ ] **Step 3: Commit**

```bash
git add spec/finance_research_block_schema.json web/src/blocks/blockSchema.json
git commit -m "feat(spec): allow count on analyst_consensus buckets (fra-6syg)"
```

---

## Task 3: Materializer (TDD)

**Files:** Create `services/analyze/src/analyst-consensus-materializer.ts`; Test `services/analyze/test/analyst-consensus-materializer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/analyze/test/analyst-consensus-materializer.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { materializeConsensusFacts } from "../src/analyst-consensus-materializer.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { AnalystConsensusEnvelope } from "../../fundamentals/src/analyst-consensus.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

const ISSUER: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const SRC = "00000000-0000-4000-a000-00000000000d";
const CLOCK = () => new Date("2026-06-04T12:00:00.000Z");

const METRIC_IDS: Record<string, string> = {
  analyst_count: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
  analyst_rating_strong_buy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002",
  analyst_rating_buy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003",
  analyst_rating_hold: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004",
  analyst_rating_sell: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0005",
  analyst_rating_strong_sell: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0006",
};

function envelope(): AnalystConsensusEnvelope {
  return {
    subject: ISSUER,
    family: "analyst_consensus",
    analyst_count: 41,
    as_of: "2026-06-04T00:00:00.000Z",
    rating_distribution: {
      counts: { strong_buy: 14, buy: 17, hold: 8, sell: 1, strong_sell: 1 },
      contributor_count: 41,
      as_of: "2026-06-04T00:00:00.000Z",
      source_id: SRC,
    },
    price_target: null,
    estimates: [],
    coverage_warnings: [],
  };
}

// Fake db: resolves analyst metric ids and captures fact inserts, echoing a
// fact_id + the inserted columns the materializer reads back.
function fakeDb() {
  const inserts: Array<Record<string, unknown>> = [];
  let n = 0;
  const db: QueryExecutor = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      if (/from metrics/i.test(text)) {
        const keys = (params?.[0] as string[]) ?? [];
        return { rows: keys.filter((k) => k in METRIC_IDS).map((k) => ({ metric_key: k, metric_id: METRIC_IDS[k] })) };
      }
      if (/insert into facts/i.test(text)) {
        const v = params ?? [];
        const factId = `fac00000-0000-4000-8000-0000000000${(++n).toString(16).padStart(2, "0")}`;
        const row = {
          fact_id: factId, subject_kind: v[0], subject_id: v[1], metric_id: v[2],
          period_kind: v[3], period_start: v[4], period_end: v[5], fiscal_year: v[6],
          fiscal_period: v[7], value_num: v[8], value_text: v[9], unit: v[10],
          currency: v[11], scale: v[12], as_of: v[13], reported_at: v[14],
          observed_at: v[15], source_id: v[16], method: v[17], adjustment_basis: v[18],
          definition_version: v[19], verification_status: v[20], freshness_class: v[21],
          coverage_level: v[22], quality_flags: JSON.parse((v[23] as string) ?? "[]"),
          entitlement_channels: JSON.parse((v[24] as string) ?? "[]"), confidence: v[25],
          supersedes: v[26] ?? null, superseded_by: null, invalidated_at: null,
          ingestion_batch_id: v[27] ?? null, created_at: v[15], updated_at: v[15],
        };
        inserts.push(row);
        return { rows: [row] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, inserts };
}

test("materializeConsensusFacts mints analyst_count + 5 rating facts and returns refs", async () => {
  const { db, inserts } = fakeDb();
  const result = await materializeConsensusFacts(db, { issuer: ISSUER, envelope: envelope(), clock: CLOCK });
  assert.ok(result);
  assert.equal(result.factRows.length, 6);
  assert.equal(result.analyst_count, 41);
  assert.equal(result.buckets.length, 5);
  assert.deepEqual(result.buckets.map((b) => b.bucket), ["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"]);
  assert.deepEqual(result.buckets.map((b) => b.count), [14, 17, 8, 1, 1]);
  // Every fact is a point-in-time vendor count bound to the rating source.
  for (const row of inserts) {
    assert.equal(row.method, "vendor");
    assert.equal(row.period_kind, "point");
    assert.equal(row.unit, "count");
    assert.equal(row.source_id, SRC);
    assert.equal(row.period_end, "2026-06-04");
  }
  assert.equal(result.analyst_count_ref, result.factRows[0].fact_id);
});

test("materializeConsensusFacts returns null when there is no rating_distribution", async () => {
  const { db } = fakeDb();
  const env = { ...envelope(), rating_distribution: null };
  assert.equal(await materializeConsensusFacts(db, { issuer: ISSUER, envelope: env, clock: CLOCK }), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `services/analyze`): `node --experimental-strip-types --test test/analyst-consensus-materializer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `services/analyze/src/analyst-consensus-materializer.ts`:

```ts
// Mints the vendor facts an analyst_consensus block binds: analyst_count plus
// one count per rating bucket. The values arrive in an AnalystConsensusEnvelope
// (not the facts table), so each is a fresh method='vendor', point-in-time fact
// via the canonical createFact path. createFact returns the row, so the emitter
// seals straight from these rows with no load query.

import { createFact, type FactInput, type FactRow } from "../../evidence/src/fact-repo.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import {
  ANALYST_RATINGS,
  type AnalystConsensusEnvelope,
  type AnalystRating,
} from "../../fundamentals/src/analyst-consensus.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";

const ANALYST_COUNT_METRIC_KEY = "analyst_count";
const RATING_METRIC_KEY: Readonly<Record<AnalystRating, string>> = {
  strong_buy: "analyst_rating_strong_buy",
  buy: "analyst_rating_buy",
  hold: "analyst_rating_hold",
  sell: "analyst_rating_sell",
  strong_sell: "analyst_rating_strong_sell",
};
const RATING_LABEL: Readonly<Record<AnalystRating, string>> = {
  strong_buy: "Strong Buy",
  buy: "Buy",
  hold: "Hold",
  sell: "Sell",
  strong_sell: "Strong Sell",
};
const VENDOR_VERIFICATION_STATUS = "authoritative" as const;
const VENDOR_FRESHNESS_CLASS = "eod" as const;

export type MaterializedConsensusBucket = {
  rating: AnalystRating;
  bucket: string;
  count: number;
  count_ref: UUID;
};

export type MaterializedConsensus = {
  analyst_count_ref: UUID;
  analyst_count: number;
  buckets: ReadonlyArray<MaterializedConsensusBucket>;
  factRows: ReadonlyArray<FactRow>;
};

export async function materializeConsensusFacts(
  db: QueryExecutor,
  input: { issuer: IssuerSubjectRef; envelope: AnalystConsensusEnvelope; clock?: () => Date },
): Promise<MaterializedConsensus | null> {
  const dist = input.envelope.rating_distribution;
  if (dist === null) return null;
  const clock = input.clock ?? (() => new Date());
  const observedAt = clock().toISOString();
  const asOf = dist.as_of;
  const periodEnd = asOf.slice(0, 10);

  const metricIds = await resolveMetricIds(db, [
    ANALYST_COUNT_METRIC_KEY,
    ...ANALYST_RATINGS.map((rating) => RATING_METRIC_KEY[rating]),
  ]);

  const mint = async (metricKey: string, value: number): Promise<FactRow> => {
    const metricId = metricIds.get(metricKey);
    if (metricId === undefined) {
      throw new Error(`analyst-consensus-materializer: no metric_id registered for "${metricKey}"`);
    }
    return createFact(db, {
      subject_kind: "issuer",
      subject_id: input.issuer.id,
      metric_id: metricId,
      period_kind: "point",
      period_end: periodEnd,
      value_num: value,
      unit: "count",
      as_of: asOf,
      observed_at: observedAt,
      source_id: dist.source_id,
      method: "vendor",
      verification_status: VENDOR_VERIFICATION_STATUS,
      freshness_class: VENDOR_FRESHNESS_CLASS,
      coverage_level: "full",
      confidence: 1,
    } satisfies FactInput);
  };

  const factRows: FactRow[] = [];
  const analystCountFact = await mint(ANALYST_COUNT_METRIC_KEY, input.envelope.analyst_count);
  factRows.push(analystCountFact);

  const buckets: MaterializedConsensusBucket[] = [];
  for (const rating of ANALYST_RATINGS) {
    const fact = await mint(RATING_METRIC_KEY[rating], dist.counts[rating]);
    factRows.push(fact);
    buckets.push({ rating, bucket: RATING_LABEL[rating], count: dist.counts[rating], count_ref: fact.fact_id });
  }

  return {
    analyst_count_ref: analystCountFact.fact_id,
    analyst_count: input.envelope.analyst_count,
    buckets,
    factRows,
  };
}

async function resolveMetricIds(
  db: QueryExecutor,
  keys: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, UUID>> {
  const { rows } = await db.query<{ metric_key: string; metric_id: string }>(
    `select metric_key, metric_id::text as metric_id
       from metrics
      where metric_key = any($1::text[])`,
    [[...keys]],
  );
  const map = new Map<string, UUID>();
  for (const row of rows) map.set(row.metric_key, row.metric_id);
  return map;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types --test test/analyst-consensus-materializer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/analyze/src/analyst-consensus-materializer.ts services/analyze/test/analyst-consensus-materializer.test.ts
git commit -m "feat(analyze): analyst-consensus fact materializer (fra-6syg)"
```

---

## Task 4: Block builder (TDD)

**Files:** Create `services/analyze/src/analyst-consensus-block-builder.ts`; Test `services/analyze/test/analyst-consensus-block-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/analyze/test/analyst-consensus-block-builder.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { buildAnalystConsensusBlock } from "../src/analyst-consensus-block-builder.ts";
import type { MaterializedConsensus } from "../src/analyst-consensus-materializer.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-00000000000d";

const materialized: MaterializedConsensus = {
  analyst_count_ref: "fac00000-0000-4000-8000-000000000001",
  analyst_count: 41,
  buckets: [
    { rating: "strong_buy", bucket: "Strong Buy", count: 14, count_ref: "fac00000-0000-4000-8000-000000000002" },
    { rating: "buy", bucket: "Buy", count: 17, count_ref: "fac00000-0000-4000-8000-000000000003" },
    { rating: "hold", bucket: "Hold", count: 8, count_ref: "fac00000-0000-4000-8000-000000000004" },
    { rating: "sell", bucket: "Sell", count: 1, count_ref: "fac00000-0000-4000-8000-000000000005" },
    { rating: "strong_sell", bucket: "Strong Sell", count: 1, count_ref: "fac00000-0000-4000-8000-000000000006" },
  ],
  factRows: [],
};

test("buildAnalystConsensusBlock carries refs + count per bucket", () => {
  const block = buildAnalystConsensusBlock({
    materialized,
    base: { id: "analyst_overview-1", snapshot_id: SNAP, as_of: "2026-06-04T00:00:00.000Z", source_refs: [SRC] },
    coverage_warning: "Limited coverage.",
  });
  assert.equal(block.kind, "analyst_consensus");
  assert.equal(block.data_ref.kind, "analyst_consensus");
  assert.equal(block.analyst_count_ref, materialized.analyst_count_ref);
  assert.deepEqual(block.distribution.map((b) => b.bucket), ["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"]);
  assert.deepEqual(block.distribution.map((b) => b.count), [14, 17, 8, 1, 1]);
  assert.equal(block.distribution[0].count_ref, materialized.buckets[0].count_ref);
  assert.equal(block.coverage_warning, "Limited coverage.");
});

test("buildAnalystConsensusBlock omits coverage_warning when absent", () => {
  const block = buildAnalystConsensusBlock({
    materialized,
    base: { id: "analyst_overview-1", snapshot_id: SNAP, as_of: "2026-06-04T00:00:00.000Z", source_refs: [SRC] },
  });
  assert.equal("coverage_warning" in block, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --test test/analyst-consensus-block-builder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `services/analyze/src/analyst-consensus-block-builder.ts`:

```ts
// Assembles an analyst_consensus block from materialized consensus facts: the
// analyst_count ref + one distribution bucket per rating, each carrying its
// backing fact (count_ref) and the pre-rendered count (the block contract
// carries display-ready data so the web stays a dumb renderer).

import type { MaterializedConsensus } from "./analyst-consensus-materializer.ts";
import type { UUID } from "../../fundamentals/src/subject-ref.ts";

export type AnalystConsensusBucket = {
  bucket: string;
  count_ref: UUID;
  count: number;
};

export type AnalystConsensusBlockBase = {
  id: string;
  snapshot_id: UUID;
  as_of: string;
  source_refs: ReadonlyArray<UUID>;
  title?: string;
};

export type AnalystConsensusBlock = {
  id: string;
  kind: "analyst_consensus";
  snapshot_id: UUID;
  data_ref: { kind: string; id: string; params?: Readonly<Record<string, unknown>> };
  source_refs: ReadonlyArray<UUID>;
  as_of: string;
  title?: string;
  analyst_count_ref: UUID;
  distribution: ReadonlyArray<AnalystConsensusBucket>;
  coverage_warning?: string;
};

export function buildAnalystConsensusBlock(input: {
  materialized: MaterializedConsensus;
  base: AnalystConsensusBlockBase;
  coverage_warning?: string;
}): AnalystConsensusBlock {
  const { materialized, base } = input;
  return {
    id: base.id,
    kind: "analyst_consensus",
    snapshot_id: base.snapshot_id,
    data_ref: { kind: "analyst_consensus", id: base.id },
    source_refs: base.source_refs,
    as_of: base.as_of,
    ...(base.title === undefined ? {} : { title: base.title }),
    analyst_count_ref: materialized.analyst_count_ref,
    distribution: materialized.buckets.map((bucket) => ({
      bucket: bucket.bucket,
      count_ref: bucket.count_ref,
      count: bucket.count,
    })),
    ...(input.coverage_warning === undefined ? {} : { coverage_warning: input.coverage_warning }),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types --test test/analyst-consensus-block-builder.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/analyze/src/analyst-consensus-block-builder.ts services/analyze/test/analyst-consensus-block-builder.test.ts
git commit -m "feat(analyze): analyst-consensus block builder (fra-6syg)"
```

---

## Task 5: Seal-input delegate (TDD)

**Files:** Create `services/analyze/src/analyst-consensus-snapshot.ts`; Test `services/analyze/test/analyst-consensus-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/analyze/test/analyst-consensus-snapshot.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { buildAnalystConsensusBlock } from "../src/analyst-consensus-block-builder.ts";
import { buildAnalystConsensusSealInput } from "../src/analyst-consensus-snapshot.ts";
import type { MaterializedConsensus } from "../src/analyst-consensus-materializer.ts";
import type { FactRow } from "../../evidence/src/fact-repo.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-00000000000d";
const PRIMARY: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const IDS = [1, 2, 3, 4, 5, 6].map((n) => `fac00000-0000-4000-8000-00000000000${n}`);

const materialized: MaterializedConsensus = {
  analyst_count_ref: IDS[0],
  analyst_count: 41,
  buckets: [
    { rating: "strong_buy", bucket: "Strong Buy", count: 14, count_ref: IDS[1] },
    { rating: "buy", bucket: "Buy", count: 17, count_ref: IDS[2] },
    { rating: "hold", bucket: "Hold", count: 8, count_ref: IDS[3] },
    { rating: "sell", bucket: "Sell", count: 1, count_ref: IDS[4] },
    { rating: "strong_sell", bucket: "Strong Sell", count: 1, count_ref: IDS[5] },
  ],
  factRows: [],
};

function factRow(id: string): FactRow {
  return {
    fact_id: id, subject_kind: "issuer", subject_id: PRIMARY.id, metric_id: id,
    period_kind: "point", period_start: null, period_end: "2026-06-04", fiscal_year: null,
    fiscal_period: null, value_num: 1, value_text: null, unit: "count", currency: null,
    scale: 1, as_of: "2026-06-04T00:00:00.000Z", reported_at: null,
    observed_at: "2026-06-04T12:00:00.000Z", source_id: SRC, method: "vendor",
    adjustment_basis: null, definition_version: 1, verification_status: "authoritative",
    freshness_class: "eod", coverage_level: "full", quality_flags: [],
    entitlement_channels: [], confidence: 1, supersedes: null, superseded_by: null,
    invalidated_at: null, ingestion_batch_id: null, created_at: "2026-06-04T12:00:00.000Z",
    updated_at: "2026-06-04T12:00:00.000Z",
  } as FactRow;
}

test("buildAnalystConsensusSealInput binds all 6 facts + the issuer subject", () => {
  const block = buildAnalystConsensusBlock({
    materialized,
    base: { id: "analyst_overview-1", snapshot_id: SNAP, as_of: "2026-06-04T00:00:00.000Z", source_refs: [SRC] },
  });
  const seal = buildAnalystConsensusSealInput({ block, facts: IDS.map(factRow), primary: PRIMARY });
  assert.deepEqual([...seal.manifest.fact_refs], IDS);
  assert.deepEqual([...seal.manifest.subject_refs], [{ kind: "issuer", id: PRIMARY.id }]);
  const bindings = (seal.blocks[0].data_ref.params?.fact_bindings ?? []) as ReadonlyArray<{ fact_id: string }>;
  assert.deepEqual(new Set(bindings.map((b) => b.fact_id)), new Set(IDS));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --test test/analyst-consensus-snapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `services/analyze/src/analyst-consensus-snapshot.ts`:

```ts
// Derives the cited consensus facts (analyst_count + bucket counts) + the issuer
// subject and delegates to the shared fact-backed seal-input core.

import { buildFactBackedSealInput } from "./block-seal-input.ts";
import type { AnalystConsensusBlock } from "./analyst-consensus-block-builder.ts";
import type { FactRow } from "../../evidence/src/fact-repo.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";

export function buildAnalystConsensusSealInput(input: {
  block: AnalystConsensusBlock;
  facts: ReadonlyArray<FactRow>;
  primary: IssuerSubjectRef;
  modelVersion?: string | null;
}): SnapshotSealInput {
  return buildFactBackedSealInput({
    block: input.block,
    factRefs: [input.block.analyst_count_ref, ...input.block.distribution.map((bucket) => bucket.count_ref)],
    subjectRefs: [{ kind: input.primary.kind, id: input.primary.id }],
    facts: input.facts,
    ...(input.modelVersion === undefined ? {} : { modelVersion: input.modelVersion }),
  });
}
```

(`FactRow` from evidence has every field `buildFactBackedSealInput`'s `FactRow` requires, so it is structurally assignable — no cast.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types --test test/analyst-consensus-snapshot.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add services/analyze/src/analyst-consensus-snapshot.ts services/analyze/test/analyst-consensus-snapshot.test.ts
git commit -m "feat(analyze): analyst-consensus seal-input delegate (fra-6syg)"
```

---

## Task 6: Emitter (TDD)

**Files:** Create `services/analyze/src/analyst-consensus-emitter.ts`; Test `services/analyze/test/analyst-consensus-emitter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/analyze/test/analyst-consensus-emitter.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { emitAnalystConsensusBlock } from "../src/analyst-consensus-emitter.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { ConsensusRepository } from "../../fundamentals/src/consensus-repository.ts";
import type { AnalystConsensusEnvelope } from "../../fundamentals/src/analyst-consensus.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-00000000000d";
const PRIMARY: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const CLOCK = () => new Date("2026-06-04T12:00:00.000Z");
const INPUT = { primary: PRIMARY, snapshotId: SNAP, blockId: "analyst_overview-1", asOf: "2026-06-04T00:00:00.000Z" };

const METRIC_IDS: Record<string, string> = {
  analyst_count: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
  analyst_rating_strong_buy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002",
  analyst_rating_buy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003",
  analyst_rating_hold: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004",
  analyst_rating_sell: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0005",
  analyst_rating_strong_sell: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0006",
};

function envelope(): AnalystConsensusEnvelope {
  return {
    subject: PRIMARY, family: "analyst_consensus", analyst_count: 41, as_of: "2026-06-04T00:00:00.000Z",
    rating_distribution: {
      counts: { strong_buy: 14, buy: 17, hold: 8, sell: 1, strong_sell: 1 },
      contributor_count: 41, as_of: "2026-06-04T00:00:00.000Z", source_id: SRC,
    },
    price_target: null, estimates: [], coverage_warnings: [],
  };
}

function consensusRepo(env: AnalystConsensusEnvelope | null): ConsensusRepository {
  return { async find() { return env; } };
}

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
        const factId = `fac00000-0000-4000-8000-0000000000${(++n).toString(16).padStart(2, "0")}`;
        return { rows: [{
          fact_id: factId, subject_kind: v[0], subject_id: v[1], metric_id: v[2], period_kind: v[3],
          period_start: v[4], period_end: v[5], fiscal_year: v[6], fiscal_period: v[7], value_num: v[8],
          value_text: v[9], unit: v[10], currency: v[11], scale: v[12], as_of: v[13], reported_at: v[14],
          observed_at: v[15], source_id: v[16], method: v[17], adjustment_basis: v[18], definition_version: v[19],
          verification_status: v[20], freshness_class: v[21], coverage_level: v[22],
          quality_flags: JSON.parse((v[23] as string) ?? "[]"), entitlement_channels: JSON.parse((v[24] as string) ?? "[]"),
          confidence: v[25], supersedes: v[26] ?? null, superseded_by: null, invalidated_at: null,
          ingestion_batch_id: v[27] ?? null, created_at: v[15], updated_at: v[15],
        }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

test("emitAnalystConsensusBlock builds a block that passes the real verifier", async () => {
  const seal = await emitAnalystConsensusBlock({ db: fakeDb(), consensus: consensusRepo(envelope()), clock: CLOCK }, INPUT);
  assert.ok(seal);
  assert.equal(seal.blocks[0].kind, "analyst_consensus");
  assert.equal(seal.manifest.fact_refs.length, 6);
  const verification = await verifySnapshotSeal(seal);
  assert.equal(verification.ok, true, verification.ok ? "" : JSON.stringify(verification.failures, null, 2));
});

test("emitAnalystConsensusBlock returns null when the envelope is null", async () => {
  const seal = await emitAnalystConsensusBlock({ db: fakeDb(), consensus: consensusRepo(null), clock: CLOCK }, INPUT);
  assert.equal(seal, null);
});

test("emitAnalystConsensusBlock returns null when rating_distribution is null", async () => {
  const env = { ...envelope(), rating_distribution: null };
  const seal = await emitAnalystConsensusBlock({ db: fakeDb(), consensus: consensusRepo(env), clock: CLOCK }, INPUT);
  assert.equal(seal, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --test test/analyst-consensus-emitter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `services/analyze/src/analyst-consensus-emitter.ts`:

```ts
// The earnings_quality playbook's deterministic emitter for the analyst_overview
// section: fetch the consensus envelope, materialize the rating-distribution
// facts, build the block, and assemble the seal input. Returns null (section
// omitted) when there is no envelope or no rating distribution. Does NOT seal —
// the run path seals the returned input in its transaction.

import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { ConsensusRepository } from "../../fundamentals/src/consensus-repository.ts";
import type { IssuerSubjectRef, UUID } from "../../fundamentals/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import { materializeConsensusFacts } from "./analyst-consensus-materializer.ts";
import { buildAnalystConsensusBlock } from "./analyst-consensus-block-builder.ts";
import { buildAnalystConsensusSealInput } from "./analyst-consensus-snapshot.ts";

export type AnalystConsensusEmitterDeps = {
  db: QueryExecutor;
  consensus: ConsensusRepository;
  clock?: () => Date;
};

export type AnalystConsensusEmitInput = {
  primary: IssuerSubjectRef;
  snapshotId: UUID;
  blockId: string;
  asOf: string;
  title?: string;
};

export async function emitAnalystConsensusBlock(
  deps: AnalystConsensusEmitterDeps,
  input: AnalystConsensusEmitInput,
): Promise<SnapshotSealInput | null> {
  const envelope = await deps.consensus.find(input.primary.id);
  if (envelope === null || envelope.rating_distribution === null) return null;

  const materialized = await materializeConsensusFacts(deps.db, {
    issuer: input.primary,
    envelope,
    clock: deps.clock,
  });
  if (materialized === null) return null;

  const coverageWarning = envelope.coverage_warnings[0]?.message;
  const block = buildAnalystConsensusBlock({
    materialized,
    base: {
      id: input.blockId,
      snapshot_id: input.snapshotId,
      as_of: input.asOf,
      source_refs: [envelope.rating_distribution.source_id],
      ...(input.title === undefined ? {} : { title: input.title }),
    },
    ...(coverageWarning === undefined ? {} : { coverage_warning: coverageWarning }),
  });

  return buildAnalystConsensusSealInput({ block, facts: materialized.factRows, primary: input.primary });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types --test test/analyst-consensus-emitter.test.ts`
Expected: PASS (3 tests; the verifier accepts the 6-fact seal).

- [ ] **Step 5: Commit**

```bash
git add services/analyze/src/analyst-consensus-emitter.ts services/analyze/test/analyst-consensus-emitter.test.ts
git commit -m "feat(analyze): analyst-consensus emitter materializes + seals (fra-6syg)"
```

---

## Task 7: Register producer + playbook section

**Files:** Modify `services/analyze/src/section-producers.ts`, `services/analyze/src/playbook.ts`, `services/analyze/test/section-producers.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `services/analyze/test/section-producers.test.ts`:

```ts
test("the earnings_quality analyst_overview section resolves to a producer", () => {
  assert.notEqual(lookupSectionProducer("earnings_quality", "analyst_overview"), undefined);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --test test/section-producers.test.ts`
Expected: FAIL (producer not registered).

- [ ] **Step 3: Add the dep, producer, and registry entry**

In `services/analyze/src/section-producers.ts`:

Add imports:
```ts
import type { ConsensusRepository } from "../../fundamentals/src/consensus-repository.ts";
import { emitAnalystConsensusBlock } from "./analyst-consensus-emitter.ts";
```

Add `consensus` (optional — peer_table doesn't need it, and an absent consensus simply omits the analyst section) to `SectionProducerDeps`:
```ts
export type SectionProducerDeps = {
  db: QueryExecutor;
  peers: PeerSetResolver;
  stats: StatsRepository;
  consensus?: ConsensusRepository;
  clock?: () => Date;
};
```

Add the producer (after `REVENUE_BARS_PRODUCER`):
```ts
const ANALYST_CONSENSUS_PRODUCER: SectionProducer = (deps, ctx) => {
  if (deps.consensus === undefined) return Promise.resolve(null);
  return emitAnalystConsensusBlock(
    { db: deps.db, consensus: deps.consensus, clock: deps.clock },
    {
      primary: ctx.primary,
      snapshotId: ctx.snapshotId,
      blockId: sectionBlockId("analyst_overview"),
      asOf: ctx.asOf,
    },
  );
};
```

Add the registry entry:
```ts
const SECTION_PRODUCERS: ReadonlyMap<string, SectionProducer> = new Map([
  ["peer_comparison:peer_table", PEER_TABLE_PRODUCER],
  ["earnings_quality:revenue_trend", REVENUE_BARS_PRODUCER],
  ["earnings_quality:analyst_overview", ANALYST_CONSENSUS_PRODUCER],
]);
```

- [ ] **Step 4: Add the playbook section**

In `services/analyze/src/playbook.ts`, add to the `earnings_quality` sections array, right after the `revenue_trend` line:
```ts
      section("revenue_trend", "Revenue trend", false, "line_chart"),
      section("analyst_overview", "Analyst overview", false, "section"),
```

- [ ] **Step 5: Run the section + playbook tests**

Run: `node --experimental-strip-types --test test/section-producers.test.ts test/section-runner.test.ts test/playbook.test.ts`
Expected: PASS. Note: `playbook.test.ts` pins the `earnings_quality` section-id list — add `"analyst_overview"` after `"revenue_trend"` in that assertion array (mirror the existing list).

- [ ] **Step 6: Commit**

```bash
git add services/analyze/src/section-producers.ts services/analyze/src/playbook.ts services/analyze/test/section-producers.test.ts services/analyze/test/playbook.test.ts
git commit -m "feat(analyze): register analyst-consensus producer on earnings_quality (fra-6syg)"
```

---

## Task 8: Wire consensus into the dev-api run path

**Files:** Modify `services/dev-api/src/local-runtime.ts`

- [ ] **Step 1: Build + thread the consensus repository**

In `services/dev-api/src/local-runtime.ts`, add imports (near the existing fundamentals imports):
```ts
import { createPostgresIssuerProfileRepository } from "../../fundamentals/src/issuer-repository.ts";
import { createDevProvidersConsensusRepository } from "../../fundamentals/src/dev-providers.ts";
import { createUnsupportedConsensusRepository } from "../../fundamentals/src/unsupported-repositories.ts";
import { YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID } from "../../fundamentals/src/provider-sources.ts";
```

Extend `analyzeSectionDeps()` to build `consensus` the same way fundamentals `dev.ts` does:
```ts
function analyzeSectionDeps() {
  const db = pool();
  const secFetcher = process.env.SEC_EDGAR_USER_AGENT
    ? createSecCompanyFactsHttpFetcher({
        userAgent: process.env.SEC_EDGAR_USER_AGENT,
        baseUrl: process.env.SEC_EDGAR_BASE_URL,
      })
    : null;
  const statements = createSecBackedStatementRepository(db, {
    fetcher: secFetcher,
    sourceId: SEC_EDGAR_FILING_SOURCE_ID,
  });
  const stats = createSecBackedStatsRepository(db, { statements, fetcher: secFetcher });
  const devProvidersBaseUrl = process.env.DEV_PROVIDERS_BASE_URL ?? process.env.DEV_PROVIDERS_ORIGIN;
  const consensus =
    process.env.ENABLE_UNOFFICIAL_DEV_PROVIDERS === "true" && devProvidersBaseUrl
      ? createDevProvidersConsensusRepository({
          profiles: createPostgresIssuerProfileRepository(db),
          baseUrl: devProvidersBaseUrl,
          sourceId: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
        })
      : createUnsupportedConsensusRepository();
  return { db, peers: createSqlPeerSetResolver(db), stats, consensus };
}
```

- [ ] **Step 2: Run the dev-api suite**

Run (from `services/dev-api`): `node --experimental-strip-types --test 'test/**/*.test.ts'`
Expected: PASS. Existing analyze runs are unaffected — consensus defaults to the unsupported repo (no sidecar in tests), so the analyst_overview section is omitted exactly as before.

- [ ] **Step 3: Commit**

```bash
git add services/dev-api/src/local-runtime.ts
git commit -m "feat(dev-api): thread consensus repo into analyze section deps (fra-6syg)"
```

---

## Task 9: Web rendering (TDD)

**Files:** Modify `web/src/blocks/types.ts`, `web/src/blocks/fixtures.ts`, `web/src/blocks/AnalystConsensus.tsx`; Create `web/src/blocks/AnalystConsensus.test.tsx`

- [ ] **Step 1: Extend the bucket type**

In `web/src/blocks/types.ts`, replace the `AnalystDistributionBucket` type:
```ts
export type AnalystDistributionBucket = {
  bucket: string
  count_ref: string
  count?: number
}
```

- [ ] **Step 2: Add counts to the fixture**

In `web/src/blocks/fixtures.ts`, replace the `distribution` array of `analystConsensusFixture` so each bucket carries `count`:
```ts
  distribution: [
    { bucket: 'Strong Buy', count_ref: 'dddddddd-1111-4111-9111-111111111aaa', count: 14 },
    { bucket: 'Buy', count_ref: 'dddddddd-1111-4111-9111-111111111bbb', count: 17 },
    { bucket: 'Hold', count_ref: 'dddddddd-1111-4111-9111-111111111ccc', count: 8 },
    { bucket: 'Sell', count_ref: 'dddddddd-1111-4111-9111-111111111ddd', count: 1 },
    { bucket: 'Strong Sell', count_ref: 'dddddddd-1111-4111-9111-111111111eee', count: 1 },
  ],
```

- [ ] **Step 3: Write the failing test**

Create `web/src/blocks/AnalystConsensus.test.tsx`:
```tsx
import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { AnalystConsensus } from './AnalystConsensus.tsx'
import { analystConsensusFixture } from './fixtures.ts'
import { validateBlock } from './BlockValidator.ts'
import type { AnalystConsensusBlock } from './types.ts'

test('the analyst_consensus fixture validates against the schema (count allowed)', () => {
  const result = validateBlock(analystConsensusFixture)
  assert.equal(result.valid, true, result.valid ? '' : JSON.stringify(result.errors, null, 2))
})

test('AnalystConsensus renders a stacked bar with counts and a total', () => {
  const html = renderToStaticMarkup(<AnalystConsensus block={analystConsensusFixture} />)
  // 41 total ratings (14+17+8+1+1), each bucket count shown.
  assert.match(html, /41 ratings/)
  assert.match(html, /rating-segment-0/)
  // Strong Buy is 14/41 ≈ 34.1% width.
  assert.match(html, /width:34\.1463/)
})

test('AnalystConsensus falls back to em-dashes when buckets lack counts', () => {
  const block: AnalystConsensusBlock = {
    id: 'ac-empty', kind: 'analyst_consensus', snapshot_id: '11111111-1111-4111-9111-111111111111',
    data_ref: { kind: 'analyst_consensus', id: 'ac-empty' }, source_refs: [], as_of: '2026-06-04T00:00:00.000Z',
    analyst_count_ref: 'dddddddd-1111-4111-9111-111111111111',
    distribution: [{ bucket: 'Strong Buy', count_ref: 'dddddddd-1111-4111-9111-111111111aaa' }],
  }
  const html = renderToStaticMarkup(<AnalystConsensus block={block} />)
  assert.match(html, /—/)
})
```

- [ ] **Step 4: Run to verify it fails**

Run (from `web`): `TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test 'src/blocks/AnalystConsensus.test.tsx'`
Expected: FAIL (current render shows em-dashes / no segments).

- [ ] **Step 5: Implement the render**

Replace `web/src/blocks/AnalystConsensus.tsx` with:
```tsx
import type { ReactElement } from 'react'
import type { AnalystConsensusBlock, AnalystDistributionBucket } from './types.ts'
import { ChartCard } from './ChartCard.tsx'

type AnalystConsensusProps = { block: AnalystConsensusBlock }

// Bucket colors by fixed rating order (strong_buy → strong_sell), matching the
// Symbol Overview consensus palette.
const BUCKET_COLORS = [
  'bg-emerald-600 dark:bg-emerald-500',
  'bg-emerald-400 dark:bg-emerald-600',
  'bg-neutral-400 dark:bg-neutral-500',
  'bg-red-400 dark:bg-red-600',
  'bg-red-600 dark:bg-red-500',
]

export function AnalystConsensus({ block }: AnalystConsensusProps): ReactElement {
  const counts = block.distribution.map((bucket) => bucket.count)
  const hasCounts = counts.every((count) => typeof count === 'number')
  const total = hasCounts ? counts.reduce((sum, count) => sum + (count as number), 0) : 0

  return (
    <ChartCard
      testId={`block-analyst-consensus-${block.id}`}
      blockKind="analyst_consensus"
      title={block.title}
      dataAttrs={{ 'data-analyst-count-ref': block.analyst_count_ref }}
    >
      {hasCounts && total > 0 ? (
        <div className="flex flex-col gap-2">
          <div
            role="img"
            aria-label={`Analyst ratings across ${total} contributors`}
            className="flex h-3 w-full overflow-hidden rounded"
          >
            {block.distribution.map((bucket, index) => {
              const count = bucket.count ?? 0
              if (count === 0) return null
              return (
                <div
                  key={`${block.id}-seg-${index}`}
                  data-testid={`block-analyst-consensus-${block.id}-rating-segment-${index}`}
                  className={BUCKET_COLORS[index] ?? 'bg-neutral-400'}
                  style={{ width: `${(count / total) * 100}%` }}
                  title={`${bucket.bucket}: ${count}`}
                />
              )
            })}
          </div>
          <ul className="flex list-none flex-col gap-1 p-0 text-sm">
            {block.distribution.map((bucket, index) => (
              <li
                key={`${block.id}-bucket-${index}`}
                data-testid={`block-analyst-consensus-${block.id}-bucket-${index}`}
                data-count-ref={bucket.count_ref}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-fg">{bucket.bucket}</span>
                <span className="num text-xs text-muted">{bucket.count}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{total} ratings</p>
        </div>
      ) : (
        <ul className="flex list-none flex-col gap-1 p-0 text-sm">
          {block.distribution.map((bucket, index) => (
            <StubRow key={`${block.id}-bucket-${index}`} blockId={block.id} index={index} bucket={bucket} />
          ))}
        </ul>
      )}
      {block.coverage_warning ? (
        <p
          data-testid={`block-analyst-consensus-${block.id}-coverage`}
          role="alert"
          className="text-xs text-warning"
        >
          {block.coverage_warning}
        </p>
      ) : null}
    </ChartCard>
  )
}

function StubRow({
  blockId,
  index,
  bucket,
}: {
  blockId: string
  index: number
  bucket: AnalystDistributionBucket
}): ReactElement {
  return (
    <li
      data-testid={`block-analyst-consensus-${blockId}-bucket-${index}`}
      data-count-ref={bucket.count_ref}
      className="flex items-center justify-between gap-3"
    >
      <span className="text-fg">{bucket.bucket}</span>
      <span className="num text-xs text-muted">—</span>
    </li>
  )
}
```

- [ ] **Step 6: Run to verify it passes**

Run (from `web`): `TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx --test 'src/blocks/AnalystConsensus.test.tsx'`
Expected: PASS (3 tests). If the `width:34.1463…` assertion is brittle, relax it to `/rating-segment-0/` + `/41 ratings/` only — but verify the computed width first.

- [ ] **Step 7: Typecheck**

Run (from `web`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/blocks/types.ts web/src/blocks/fixtures.ts web/src/blocks/AnalystConsensus.tsx web/src/blocks/AnalystConsensus.test.tsx
git commit -m "feat(web): render real analyst_consensus stacked bar (fra-6syg)"
```

---

## Task 10: Final verification + bead bookkeeping

- [ ] **Step 1: Run the analyze + dev-api + web suites**

```
cd services/analyze && node --experimental-strip-types --test 'test/**/*.test.ts'
cd ../dev-api && node --experimental-strip-types --test 'test/**/*.test.ts'
cd ../../web && npm test && npm run typecheck
```
Expected: all PASS.

- [ ] **Step 2: File the deferred price_target_range work**

```bash
bd create --title="Persist current-price facts (quote->fact) for price_target_range" --type=task --priority=3 \
  --description="price_target_range needs a current-price FACT (current_price_ref), but the market/quote service only caches quotes — nothing writes price facts. Add a quote->fact path (a 'price' metric fact from the market quote) so price_target_range can bind a current price."
bd create --title="Build price_target_range block emitter (deferred from fra-6syg)" --type=task --priority=3 \
  --description="Mirror the analyst_consensus emitter for price_target_range: materialize price-target facts (low/mean/median/high) from the AnalystConsensusEnvelope + a current-price fact, build + seal the block, render an inline range bar. Blocked on a current-price fact source."
# wire deps: price_target_range emitter depends on the price-fact source; fra-6syg depends on the emitter
```
(Use the printed IDs: `bd dep add <price-emitter-id> <price-fact-id>` and `bd dep add fra-6syg <price-emitter-id>`.)

- [ ] **Step 3: Continue to `fra-q840`**

Leave `fra-6syg` OPEN (now tracking only the deferred price_target_range work). Do NOT finish the branch — `fra-q840` continues on `feat/analyst-consensus`.

---

## Self-Review notes

- **Spec coverage:** metrics seed (Task 1) · `count` schema field (Task 2) · materializer mints 6 vendor point facts (Task 3) · builder w/ count (Task 4) · seal delegate via shared core (Task 5) · emitter + verifySnapshotSeal + null paths (Task 6) · producer/playbook + optional `consensus` dep (Task 7) · dev-api wiring graceful when sidecar off (Task 8) · inline stacked bar + stub fallback + validateBlock (Task 9) · deferred price work filed (Task 10).
- **Type consistency:** `MaterializedConsensus`/`MaterializedConsensusBucket`, `AnalystConsensusBlock`/`AnalystConsensusBucket`, `buildAnalystConsensusSealInput`, `AnalystConsensusEmitterDeps`, `SectionProducerDeps.consensus`, `AnalystDistributionBucket.count` used identically across tasks.
- **Out of scope:** price_target_range (deferred bead), analyst headline-count display field (header shows `sum(counts)`), web primitive extraction.
