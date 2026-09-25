// Shared harness for the grid financial-column tests: a real engine database,
// a grid over the seeded issuers, and a run started through the production
// run engine with the financial lane enforced.

import type { TestContext } from "node:test";
import type { Client, Pool } from "pg";
import { connectedPool } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { databaseUrl, engineDatabase, IDS } from "../../financial-engine/test/db-fixtures.ts";
import type { GridFinancialMode } from "../src/financial-column.ts";
import { createGrid, getRunDetail, type GridRunDetail } from "../src/queries.ts";
import { startGridRun } from "../src/run-engine.ts";
import type { ColumnSpec, QueryExecutor } from "../src/types.ts";
import { createUniverseResolverDeps } from "../src/universe-wiring.ts";

/** After both fixture filings are public; as-reported revenue is the original FY2023 disclosure. */
export const CUTOFF = "2024-03-01T00:00:00.000Z";

export async function gridDatabase(t: TestContext, prefix: string): Promise<{ db: Client; pool: Pool }> {
  const db = await engineDatabase(t, prefix);
  const pool = await connectedPool(t, databaseUrl(db));
  return { db, pool };
}

export const REVENUE_COLUMNS: ColumnSpec[] = [
  { column_key: "latest_revenue" },
  { column_key: "latest_revenue", params: { period_type: "annual", offset: 1 } },
  { column_key: "latest_market_cap" },
];

export async function startRun(pool: Pool, input: { columns?: ColumnSpec[]; asOf?: string; mode?: GridFinancialMode } = {}) {
  const db = pool as unknown as QueryExecutor;
  const grid = await createGrid(db, IDS.owner, {
    name: "Fixture grid",
    description: null,
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: IDS.issuerA }, { kind: "issuer", id: IDS.issuerB }] },
    column_specs: input.columns ?? REVENUE_COLUMNS,
  });
  const { runId } = await startGridRun(
    {
      db,
      pool,
      universe: createUniverseResolverDeps(db),
      financial: { mode: input.mode ?? "enforce", pool, evidence: createEvidenceFinancialPort },
    },
    { gridId: grid.grid_id, userId: IDS.owner, asOf: input.asOf ?? CUTOFF },
  );
  return { gridId: grid.grid_id, runId };
}

/** Waits for a condition on the run's detail (the run worker is detached from the start call). */
export async function waitForRun(pool: Pool, runId: string, until: (detail: GridRunDetail) => boolean, deadlineMs = 60_000): Promise<GridRunDetail> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const detail = await getRunDetail(pool as unknown as QueryExecutor, runId);
    if (until(detail)) return detail;
    if (Date.now() > deadline) throw new Error(`grid run ${runId} did not reach the expected state: ${JSON.stringify(detail.run)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export const settled = (detail: GridRunDetail) => ["completed", "partial", "failed"].includes(detail.run.status);

/** Cells by `${row_number}:${column_instance_id}`. */
export function cellsByPosition(detail: GridRunDetail) {
  const rowNumber = new Map(detail.rows.map((row) => [row.grid_row_id, row.row_number]));
  return Object.fromEntries(detail.cells.map((cell) => [`${rowNumber.get(cell.grid_row_id)}:${cell.column_instance_id}`, cell]));
}
