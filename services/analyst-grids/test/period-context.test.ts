import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import { resolvePeriodContext } from "../src/period-context.ts";

const ISSUER = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const SOURCE = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

async function seedFact(
  db: { query: (t: string, v?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  period: { period_kind: string; fiscal_year: number | null; fiscal_period: string | null; period_end: string | null; as_of: string },
  metricKey = "revenue",
) {
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash)
     values ($1, 'test', 'filing', 'primary', 'public', now(), 'h')
     on conflict (source_id) do nothing`,
    [SOURCE],
  );
  const metric = await db.query(
    `insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ($1, $1, 'currency', 'last', 'higher_is_better', 'filing')
     on conflict (metric_key) do update set display_name = excluded.display_name
     returning metric_id::text as metric_id`,
    [metricKey],
  );
  await db.query(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_end, fiscal_year, fiscal_period,
                        value_num, unit, as_of, observed_at, source_id, method, verification_status,
                        freshness_class, coverage_level, confidence, entitlement_channels)
     values ('issuer', $1, $2, $3, $4, $5, $6, 100, 'USD', $7, $7, $8, 'reported', 'authoritative', 'filing_time', 'full', 1, '["app"]'::jsonb)`,
    [ISSUER, metric.rows[0].metric_id, period.period_kind, period.period_end, period.fiscal_year, period.fiscal_period, period.as_of, SOURCE],
  );
}

test("resolvePeriodContext returns the latest reported fiscal period for an issuer", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "grid-period");
  const db = await connectedClient(t, databaseUrl);
  await seedFact(db, { period_kind: "fiscal_q", fiscal_year: 2025, fiscal_period: "Q1", period_end: "2025-03-31", as_of: "2025-04-15T00:00:00.000Z" });
  await seedFact(db, { period_kind: "fiscal_q", fiscal_year: 2025, fiscal_period: "Q2", period_end: "2025-06-30", as_of: "2025-07-15T00:00:00.000Z" });

  const period = await resolvePeriodContext(db, { kind: "issuer", id: ISSUER });
  assert.equal(period?.fiscal_year, 2025);
  assert.equal(period?.fiscal_period, "Q2");
  assert.equal(period?.period_kind, "fiscal_q");
  assert.equal(period?.period_end, "2025-06-30");
  assert.deepEqual(period?.document_refs, []);
});

test("resolvePeriodContext ignores a newer point fact and returns the latest fiscal period", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "grid-period-point");
  const db = await connectedClient(t, databaseUrl);
  await seedFact(db, { period_kind: "fiscal_q", fiscal_year: 2025, fiscal_period: "Q1", period_end: "2025-03-31", as_of: "2025-04-15T00:00:00.000Z" });
  await seedFact(db, { period_kind: "fiscal_q", fiscal_year: 2025, fiscal_period: "Q2", period_end: "2025-06-30", as_of: "2025-07-15T00:00:00.000Z" });
  // A newer point fact (e.g. market_cap) with NULL fiscal fields must NOT win.
  await seedFact(
    db,
    { period_kind: "point", fiscal_year: null, fiscal_period: null, period_end: null, as_of: "2025-08-01T00:00:00.000Z" },
    "market_cap",
  );

  const period = await resolvePeriodContext(db, { kind: "issuer", id: ISSUER });
  assert.equal(period?.fiscal_year, 2025);
  assert.equal(period?.fiscal_period, "Q2");
  assert.equal(period?.period_kind, "fiscal_q");
  assert.equal(period?.period_end, "2025-06-30");
  assert.deepEqual(period?.document_refs, []);
});

test("resolvePeriodContext ignores facts outside the app entitlement channel", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "grid-period-entitlement");
  const db = await connectedClient(t, databaseUrl);
  await seedFact(db, { period_kind: "fiscal_q", fiscal_year: 2025, fiscal_period: "Q1", period_end: "2025-03-31", as_of: "2025-04-15T00:00:00.000Z" });
  // A newer fiscal fact gated to a non-app channel must not drive the period.
  const metric = await db.query(
    `select metric_id::text as metric_id from metrics where metric_key = 'revenue'`,
  );
  await db.query(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_end, fiscal_year, fiscal_period,
                        value_num, unit, as_of, observed_at, source_id, method, verification_status,
                        freshness_class, coverage_level, confidence, entitlement_channels)
     values ('issuer', $1, $2, 'fiscal_q', '2025-06-30', 2025, 'Q2', 100, 'USD',
             '2025-07-15T00:00:00.000Z', '2025-07-15T00:00:00.000Z', $3, 'reported', 'authoritative',
             'filing_time', 'full', 1, '["pro"]'::jsonb)`,
    [ISSUER, metric.rows[0].metric_id, SOURCE],
  );

  const period = await resolvePeriodContext(db, { kind: "issuer", id: ISSUER });
  assert.equal(period?.fiscal_period, "Q1");
  assert.equal(period?.period_end, "2025-03-31");
});

test("resolvePeriodContext returns null for a non-issuer subject", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "grid-period-nonissuer");
  const db = await connectedClient(t, databaseUrl);
  const period = await resolvePeriodContext(db, { kind: "instrument", id: ISSUER });
  assert.equal(period, null);
});

test("resolvePeriodContext returns null when the issuer has no facts", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "grid-period-empty");
  const db = await connectedClient(t, databaseUrl);
  const period = await resolvePeriodContext(db, { kind: "issuer", id: "cccccccc-cccc-4ccc-cccc-cccccccccccc" });
  assert.equal(period, null);
});
