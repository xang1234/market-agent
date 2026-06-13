import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrapDatabase, connectedPool } from "../../../db/test/docker-pg.ts";
import { createGrid, getRunDetail } from "../src/queries.ts";
import { startGridRun } from "../src/run-engine.ts";
import { createUniverseResolverDeps } from "../src/universe-wiring.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER = "11111111-1111-4111-a111-111111111111";

async function poll<T>(fn: () => Promise<T>, until: (v: T) => boolean, tries = 60): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (until(v)) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("poll timed out");
}

test("startGridRun runs a deterministic column end-to-end and seals an inspectable cell", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "grid-run-e2e");
  const pool = await connectedPool(t, databaseUrl);
  const db = pool as unknown as QueryExecutor;

  const sourceId = randomUUID();
  const issuerId = randomUUID();
  const metricId = randomUUID();
  await pool.query(`insert into users (user_id, email, display_name) values ($1, 'a@b.co', 'A') on conflict (user_id) do nothing`, [USER]);
  await pool.query(`insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at) values ($1, 'SEC EDGAR', 'filing', 'primary', 'permissive', now())`, [sourceId]);
  await pool.query(`insert into issuers (issuer_id, legal_name) values ($1, 'Acme Corp')`, [issuerId]);
  await pool.query(`insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class) values ($1, 'market_cap', 'Market Cap', 'currency', 'last', 'higher_is_better', 'market')`, [metricId]);
  await pool.query(`insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, value_num, unit, as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence, period_end) values ($1,'issuer',$2,$3,'point', 3200000000000, 'USD', now(), now(), $4, 'reported','authoritative','eod','full', 0.95, '2024-03-31')`, [randomUUID(), issuerId, metricId, sourceId]);

  const grid = await createGrid(db, USER, {
    name: "mc",
    description: null,
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: issuerId }] },
    column_specs: [{ column_key: "latest_market_cap" }],
  });

  const universe = createUniverseResolverDeps(db);
  const { runId } = await startGridRun({ db, pool, universe }, { gridId: grid.grid_id, userId: USER, asOf: new Date().toISOString() });

  const detail = await poll(() => getRunDetail(db, runId), (d) => ["completed", "partial", "failed"].includes(d.run.status));
  assert.equal(detail.run.status, "completed");
  assert.equal(detail.run.cell_done, 1);
  assert.equal(detail.cells[0].status, "ok");
  assert.ok(detail.cells[0].snapshot_id, "cell should carry a sealed snapshot id");
  assert.equal(detail.cells[0].primary_ref?.kind, "fact");
});
