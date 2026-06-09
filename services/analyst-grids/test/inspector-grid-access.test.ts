import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import { loadEvidenceInspection } from "../../evidence/src/inspector.ts";
import type { QueryExecutor } from "../src/types.ts";

test("grid owner can inspect a snapshot referenced by their grid cell", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "analyst-grids-inspect");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

  const ownerId = randomUUID();
  const strangerId = randomUUID();
  const issuerId = randomUUID();
  const metricId = randomUUID();
  const sourceId = randomUUID();
  const factId = randomUUID();
  const snapshotId = randomUUID();

  await db.query(`insert into users (user_id, email) values ($1,$2),($3,$4)`, [
    ownerId, `${ownerId}@t.dev`, strangerId, `${strangerId}@t.dev`,
  ]);
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
     values ($1,'SEC EDGAR','filing','primary','permissive',now())`,
    [sourceId],
  );
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1,'Acme')`, [issuerId]);
  await db.query(
    `insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ($1,'market_cap','Market Cap','currency','last','higher_is_better','market')`,
    [metricId],
  );
  await db.query(
    `insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, value_num, unit,
        as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence, period_end)
     values ($1,'issuer',$2,$3,'point',3200000000000,'USD',now(),now(),$4,'reported','authoritative','eod','full',0.95,'2024-03-31')`,
    [factId, issuerId, metricId, sourceId],
  );
  await db.query(
    `insert into snapshots (snapshot_id, subject_refs, fact_refs, source_ids, as_of, basis, normalization, allowed_transforms)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb, now(), 'unadjusted', 'raw', '{}'::jsonb)`,
    [snapshotId, JSON.stringify([{ kind: "issuer", id: issuerId }]), JSON.stringify([factId]), JSON.stringify([sourceId])],
  );

  const gridId = randomUUID();
  const runId = randomUUID();
  const rowId = randomUUID();
  await db.query(
    `insert into research_grids (grid_id, user_id, name, universe_spec, column_specs)
     values ($1,$2,'g','{"source":"manual","subject_refs":[]}'::jsonb,'[]'::jsonb)`,
    [gridId, ownerId],
  );
  await db.query(
    `insert into grid_runs (grid_run_id, grid_id, user_id, status, as_of)
     values ($1,$2,$3,'completed',now())`,
    [runId, gridId, ownerId],
  );
  await db.query(
    `insert into grid_rows (grid_row_id, grid_run_id, row_number, subject_ref, status)
     values ($1,$2,0,$3::jsonb,'resolved')`,
    [rowId, runId, JSON.stringify({ kind: "issuer", id: issuerId })],
  );
  await db.query(
    `insert into grid_cells (grid_row_id, grid_run_id, column_key, status, snapshot_id, primary_ref)
     values ($1,$2,'latest_market_cap','ok',$3,$4::jsonb)`,
    [rowId, runId, snapshotId, JSON.stringify({ kind: "fact", id: factId })],
  );

  const inspection = await loadEvidenceInspection(db, {
    user_id: ownerId,
    snapshot_id: snapshotId,
    ref: { kind: "fact", id: factId },
  });
  assert.equal(inspection.ref.id, factId);

  await assert.rejects(() =>
    loadEvidenceInspection(db, { user_id: strangerId, snapshot_id: snapshotId, ref: { kind: "fact", id: factId } }),
  );
});
