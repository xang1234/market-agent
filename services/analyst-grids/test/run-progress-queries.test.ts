import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import {
  createGrid,
  createRun,
  insertRow,
  insertPendingCell,
  loadRunForUser,
  setRunStatus,
  markRowResolved,
  markRowFailed,
  bumpCellDone,
  getRunDetail,
} from "../src/queries.ts";

const USER = "11111111-1111-4111-a111-111111111111";

async function seedUser(db: { query: (t: string, v?: unknown[]) => Promise<unknown> }) {
  await db.query(
    `insert into users (user_id, email, display_name) values ($1, $2, $3)
     on conflict (user_id) do nothing`,
    [USER, "a@b.co", "A"],
  );
}

test("run progress helpers advance run/row/cell state and read detail", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "grid-run-progress");
  const db = await connectedClient(t, databaseUrl);
  await seedUser(db);

  const grid = await createGrid(db, USER, {
    name: "g",
    description: null,
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" }] },
    column_specs: [{ column_key: "latest_market_cap" }],
  });
  const runId = await createRun(db, { gridId: grid.grid_id, userId: USER, asOf: "2026-06-09T00:00:00.000Z", cellTotal: 1, droppedRowCount: 0 });

  assert.equal((await loadRunForUser(db, USER, runId))?.grid_run_id, runId);
  assert.equal(await loadRunForUser(db, "22222222-2222-4222-a222-222222222222", runId), null);

  const rowId = await insertRow(db, { gridRunId: runId, rowNumber: 0, subjectRef: { kind: "issuer", id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" } });
  await insertPendingCell(db, { gridRowId: rowId, gridRunId: runId, columnKey: "latest_market_cap" });

  await setRunStatus(db, runId, "running");
  await markRowResolved(db, rowId, { period_kind: "point", fiscal_year: null, fiscal_period: null, period_start: null, period_end: null, document_refs: [] });
  await bumpCellDone(db, runId);
  await setRunStatus(db, runId, "completed", { completedAt: true });

  const detail = await getRunDetail(db, runId);
  assert.equal(detail.run.status, "completed");
  assert.equal(detail.run.cell_done, 1);
  assert.equal(detail.rows.length, 1);
  assert.equal(detail.rows[0].status, "resolved");
  assert.equal(detail.rows[0].period_context?.period_kind, "point");
  assert.equal(detail.cells.length, 1);
  assert.equal(detail.cells[0].column_key, "latest_market_cap");

  await markRowFailed(db, rowId);
  const after = await getRunDetail(db, runId);
  assert.equal(after.rows[0].status, "failed");
});
