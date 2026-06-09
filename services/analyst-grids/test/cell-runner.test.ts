import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import { computeAndPersistCell } from "../src/cell-runner.ts";
import { getColumn } from "../src/column-catalog.ts";
import { createGrid, createRun, insertRow, insertPendingCell } from "../src/queries.ts";
import type { QueryExecutor } from "../src/types.ts";

test("computeAndPersistCell seals a snapshot and writes an ok cell", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "analyst-grids-cell");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());

  const userId = randomUUID();
  const issuerId = randomUUID();
  const metricId = randomUUID();
  const sourceId = randomUUID();
  const factId = randomUUID();
  await db.query(`insert into users (user_id, email) values ($1, $2)`, [userId, `${userId}@t.dev`]);
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

  const grid = await createGrid(db, userId, {
    name: "g",
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: issuerId }] },
    column_specs: [{ column_key: "latest_market_cap" }],
  });
  const runId = await createRun(db, { gridId: grid.grid_id, userId, asOf: new Date().toISOString(), cellTotal: 1, droppedRowCount: 0 });
  const rowId = await insertRow(db, { gridRunId: runId, rowNumber: 0, subjectRef: { kind: "issuer", id: issuerId } });
  await insertPendingCell(db, { gridRowId: rowId, gridRunId: runId, columnKey: "latest_market_cap" });

  await computeAndPersistCell(
    { db, pool },
    {
      column: getColumn("latest_market_cap")!,
      gridRowId: rowId,
      subject: { kind: "issuer", id: issuerId },
      period: null,
      asOf: new Date().toISOString(),
    },
  );

  const { rows } = await db.query<{ status: string; snapshot_id: string | null; display: unknown }>(
    `select status, snapshot_id::text as snapshot_id, display from grid_cells where grid_row_id = $1`,
    [rowId],
  );
  assert.equal(rows[0].status, "ok");
  assert.ok(rows[0].snapshot_id, "expected a sealed snapshot id");
});
