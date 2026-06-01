import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  materializePeerMetricFacts,
  type MaterializeOptions,
} from "../src/metrics-comparison-materializer.ts";
import type {
  PeerMetricPeriod,
  PeerMetrics,
  PeerMetricValue,
} from "../../fundamentals/src/peer-metrics.ts";

const SUBJECT = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" } as const;
const SRC = "00000000-0000-4000-a000-0000000000ed";
const REV_FACT = "f0000000-0000-4000-8000-000000000001";
const GP_FACT = "f0000000-0000-4000-8000-000000000002";
const GROSS_MARGIN_METRIC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0038";
const AS_OF = "2024-11-01T20:30:00.000Z";
const NOW = "2025-01-15T12:00:00.000Z";

const PERIOD: PeerMetricPeriod = {
  period_kind: "fiscal_y",
  period_start: "2023-10-01",
  period_end: "2024-09-28",
  fiscal_year: 2024,
  fiscal_period: "FY",
};

const OPTS: MaterializeOptions = { clock: () => new Date(NOW) };

function value(overrides: Partial<PeerMetricValue> & Pick<PeerMetricValue, "metric" | "value_num">): PeerMetricValue {
  return {
    unit: "ratio",
    format: "percent",
    as_of: AS_OF,
    source_id: SRC,
    period: PERIOD,
    coverage_level: "full",
    input_fact_ids: [],
    ...overrides,
  };
}

const REVENUE = value({
  metric: "revenue",
  value_num: 391_035_000_000,
  unit: "currency",
  format: "currency",
  input_fact_ids: [REV_FACT],
});

const GROSS_MARGIN = value({
  metric: "gross_margin",
  value_num: 0.462,
  input_fact_ids: [GP_FACT, REV_FACT],
});

type InsertCall = { values: unknown[] };

// Mock QueryExecutor: answers the metric_id lookup and captures fact inserts,
// echoing the inserted values back as the RETURNING row (only fact_id is read
// downstream).
function mockDb(metricIds: Readonly<Record<string, string>> = { gross_margin: GROSS_MARGIN_METRIC_ID }) {
  const inserts: InsertCall[] = [];
  let metricLookups = 0;

  const db = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      if (/from metrics/i.test(text)) {
        metricLookups += 1;
        const keys = (params?.[0] as string[]) ?? [];
        return { rows: keys.filter((k) => metricIds[k]).map((k) => ({ metric_key: k, metric_id: metricIds[k] })) };
      }
      if (/insert into facts/i.test(text)) {
        const values = params ?? [];
        inserts.push({ values });
        return { rows: [factRowFromValues(randomUUID(), values)] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, inserts, metricLookupCount: () => metricLookups };
}

// createFact inserts in a fixed column order; map it back to the RETURNING row
// shape factRowFromDb consumes.
function factRowFromValues(factId: string, v: unknown[]): Record<string, unknown> {
  return {
    fact_id: factId,
    subject_kind: v[0], subject_id: v[1], metric_id: v[2], period_kind: v[3],
    period_start: v[4], period_end: v[5], fiscal_year: v[6], fiscal_period: v[7],
    value_num: v[8], value_text: v[9], unit: v[10], currency: v[11], scale: v[12],
    as_of: v[13], reported_at: v[14], observed_at: v[15], source_id: v[16],
    method: v[17], adjustment_basis: v[18], definition_version: v[19],
    verification_status: v[20], freshness_class: v[21], coverage_level: v[22],
    quality_flags: JSON.parse(v[23] as string), entitlement_channels: JSON.parse(v[24] as string),
    confidence: v[25], supersedes: v[26] ?? null, superseded_by: null,
    invalidated_at: null, ingestion_batch_id: v[27] ?? null,
    created_at: v[15], updated_at: v[15],
  };
}

// Column indices in createFact's insert values array.
const COL = { metric_id: 2, period_kind: 3, fiscal_year: 6, value_num: 8, unit: 10, as_of: 13, observed_at: 15, source_id: 16, method: 17, verification_status: 20, freshness_class: 21, coverage_level: 22, quality_flags: 23 };

test("computed metric mints one derived fact with period, provenance, and lineage", async () => {
  const { db, inserts } = mockDb();
  const peers: PeerMetrics[] = [{ subject: SUBJECT, metrics: [GROSS_MARGIN] }];

  const [out] = await materializePeerMetricFacts(db, peers, OPTS);

  assert.equal(inserts.length, 1);
  const v = inserts[0].values;
  assert.equal(v[COL.method], "derived");
  assert.equal(v[COL.metric_id], GROSS_MARGIN_METRIC_ID);
  assert.equal(v[COL.value_num], 0.462);
  assert.equal(v[COL.unit], "ratio");
  assert.equal(v[COL.period_kind], "fiscal_y");
  assert.equal(v[COL.fiscal_year], 2024);
  assert.equal(v[COL.as_of], AS_OF);
  assert.equal(v[COL.observed_at], NOW);
  assert.equal(v[COL.source_id], SRC);
  assert.equal(v[COL.verification_status], "authoritative");
  assert.equal(v[COL.freshness_class], "filing_time");
  assert.equal(v[COL.coverage_level], "full");

  const lineage = JSON.parse(v[COL.quality_flags] as string);
  assert.deepEqual(lineage, [{ kind: "derivation", metric: "gross_margin", input_fact_ids: [GP_FACT, REV_FACT] }]);

  // The cell points at the freshly minted fact.
  const cell = out.metrics.find((m) => m.metric === "gross_margin");
  assert.ok(cell);
  assert.match(cell.value_ref, /^[0-9a-f-]{36}$/);
  assert.equal(cell.value_num, 0.462);
  assert.equal(cell.format, "percent");
});

test("revenue reuses its existing fact instead of minting a derived duplicate", async () => {
  const { db, inserts } = mockDb();
  const peers: PeerMetrics[] = [{ subject: SUBJECT, metrics: [REVENUE, GROSS_MARGIN] }];

  const [out] = await materializePeerMetricFacts(db, peers, OPTS);

  // Only the computed metric inserts; revenue does not.
  assert.equal(inserts.length, 1);
  const revenue = out.metrics.find((m) => m.metric === "revenue");
  assert.ok(revenue);
  assert.equal(revenue.value_ref, REV_FACT);
});

test("a reusable metric with no lineage is dropped (renders as a gap)", async () => {
  const { db, inserts } = mockDb();
  const revenueNoFact = value({ metric: "revenue", value_num: 1, unit: "currency", format: "currency", input_fact_ids: [] });
  const peers: PeerMetrics[] = [{ subject: SUBJECT, metrics: [revenueNoFact] }];

  const [out] = await materializePeerMetricFacts(db, peers, OPTS);

  assert.equal(inserts.length, 0);
  assert.equal(out.metrics.length, 0);
});

test("metric_ids are resolved once for the whole batch", async () => {
  const { db, metricLookupCount } = mockDb();
  const peers: PeerMetrics[] = [
    { subject: SUBJECT, metrics: [GROSS_MARGIN] },
    { subject: { kind: "issuer", id: "33333333-3333-4333-8333-333333333333" }, metrics: [GROSS_MARGIN] },
  ];

  await materializePeerMetricFacts(db, peers, OPTS);
  assert.equal(metricLookupCount(), 1);
});

test("throws when a computed metric has no seeded metric_id", async () => {
  const { db } = mockDb({}); // metrics lookup returns nothing
  const peers: PeerMetrics[] = [{ subject: SUBJECT, metrics: [GROSS_MARGIN] }];

  await assert.rejects(
    () => materializePeerMetricFacts(db, peers, OPTS),
    /no metric_id registered for derived metric "gross_margin"/,
  );
});
