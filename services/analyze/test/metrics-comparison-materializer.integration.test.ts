import test from "node:test";
import assert from "node:assert/strict";

import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { materializePeerMetricFacts } from "../src/metrics-comparison-materializer.ts";
import type { DerivedPeerMetric, PeerMetrics } from "../../fundamentals/src/peer-metrics.ts";

const ISSUER = "22222222-2222-4222-a222-222222222222";
const SOURCE = "00000000-0000-4000-a000-0000000000ed";
const REV_FACT = "f0000000-0000-4000-8000-000000000001";
const GP_FACT = "f0000000-0000-4000-8000-000000000002";
const OTHER_GP_FACT = "f0000000-0000-4000-8000-000000000003";

function grossMargin(overrides: Partial<DerivedPeerMetric> = {}): PeerMetrics {
  return {
    subject: { kind: "issuer", id: ISSUER },
    metrics: [{
      kind: "derived",
      metric: "gross_margin",
      value_num: 0.462,
      unit: "ratio",
      format: "percent",
      as_of: "2024-11-01T20:30:00.000Z",
      source_id: SOURCE,
      period: { period_kind: "fiscal_y", period_start: "2023-10-01", period_end: "2024-09-28", fiscal_year: 2024, fiscal_period: "FY" },
      coverage_level: "full",
      input_fact_ids: [GP_FACT, REV_FACT],
      ...overrides,
    }],
  };
}

test("materializing identical derived metrics reuses the stored fact (#134)", { skip: !dockerAvailable() }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "analyze-derived-reuse");
  const db = await connectedClient(t, databaseUrl);
  await db.query(
    `insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ('gross_margin', 'Gross Margin', 'percent', 'derived', 'higher_is_better', 'derived')
     on conflict (metric_key) do nothing`,
  );
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
     values ($1, 'sec_edgar', 'filing', 'primary', 'public', '2024-11-01T20:30:00Z')`,
    [SOURCE],
  );
  const derivedCount = async () =>
    Number((await db.query(`select count(*)::int as n from facts where method = 'derived'`)).rows[0].n);
  const at = (iso: string) => ({ clock: () => new Date(iso) });
  const refOf = (peers: Awaited<ReturnType<typeof materializePeerMetricFacts>>) => peers[0]!.metrics[0]!.value_ref;

  const first = refOf(await materializePeerMetricFacts(db, [grossMargin()], at("2025-01-15T12:00:00.000Z")));
  const again = refOf(await materializePeerMetricFacts(db, [grossMargin()], at("2025-02-01T12:00:00.000Z")));
  assert.equal(again, first, "the same computation points at the stored fact");
  assert.equal(await derivedCount(), 1, "no new fact row");

  await t.test("different lineage is a different fact", async () => {
    const other = refOf(await materializePeerMetricFacts(db, [grossMargin({ input_fact_ids: [OTHER_GP_FACT, REV_FACT] })], at("2025-02-01T12:00:00.000Z")));
    assert.notEqual(other, first);
  });

  await t.test("a different value is a different fact", async () => {
    const other = refOf(await materializePeerMetricFacts(db, [grossMargin({ value_num: 0.5 })], at("2025-02-01T12:00:00.000Z")));
    assert.notEqual(other, first);
  });

  await t.test("a fact observed after the caller's clock is not reused", async () => {
    // Sealing as of an earlier cutoff must not cite a fact that cutoff could not know.
    const earlier = refOf(await materializePeerMetricFacts(db, [grossMargin()], at("2025-01-01T00:00:00.000Z")));
    assert.notEqual(earlier, first);
  });
});
