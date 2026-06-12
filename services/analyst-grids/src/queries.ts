import {
  GridNotFoundError,
  type CellDisplay,
  type CellRef,
  type CellStatus,
  type CellWrite,
  type CreateGridInput,
  type QueryExecutor,
  type ResearchGridRow,
} from "./types.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";

const GRID_COLUMNS = `grid_id::text as grid_id,
       user_id::text as user_id,
       name,
       description,
       universe_spec,
       column_specs,
       created_at,
       updated_at`;

type GridDbRow = {
  grid_id: string;
  user_id: string;
  name: string;
  description: string | null;
  universe_spec: unknown;
  column_specs: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toGrid(row: GridDbRow): ResearchGridRow {
  return {
    grid_id: row.grid_id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    universe_spec: row.universe_spec as ResearchGridRow["universe_spec"],
    column_specs: row.column_specs as ResearchGridRow["column_specs"],
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export async function createGrid(
  db: QueryExecutor,
  userId: string,
  input: CreateGridInput,
): Promise<ResearchGridRow> {
  const result = await db.query<GridDbRow>(
    `insert into research_grids (user_id, name, description, universe_spec, column_specs)
     values ($1, $2, $3, $4::jsonb, $5::jsonb)
     returning ${GRID_COLUMNS}`,
    [
      userId,
      input.name,
      input.description ?? null,
      JSON.stringify(input.universe_spec),
      JSON.stringify(input.column_specs),
    ],
  );
  return toGrid(result.rows[0]);
}

export async function getGrid(
  db: QueryExecutor,
  userId: string,
  gridId: string,
): Promise<ResearchGridRow> {
  const result = await db.query<GridDbRow>(
    `select ${GRID_COLUMNS} from research_grids where grid_id = $1 and user_id = $2`,
    [gridId, userId],
  );
  if (!result.rows[0]) throw new GridNotFoundError();
  return toGrid(result.rows[0]);
}

export async function listGrids(
  db: QueryExecutor,
  userId: string,
): Promise<ReadonlyArray<ResearchGridRow>> {
  const result = await db.query<GridDbRow>(
    `select ${GRID_COLUMNS} from research_grids
      where user_id = $1
      order by updated_at desc, grid_id asc`,
    [userId],
  );
  return result.rows.map(toGrid);
}

export async function createRun(
  db: QueryExecutor,
  input: {
    gridId: string;
    userId: string;
    asOf: string;
    cellTotal: number;
    droppedRowCount: number;
  },
): Promise<string> {
  const result = await db.query<{ grid_run_id: string }>(
    `insert into grid_runs (grid_id, user_id, status, as_of, cell_total, dropped_row_count)
     values ($1, $2, 'pending', $3, $4, $5)
     returning grid_run_id::text as grid_run_id`,
    [input.gridId, input.userId, input.asOf, input.cellTotal, input.droppedRowCount],
  );
  return result.rows[0].grid_run_id;
}

export async function insertRow(
  db: QueryExecutor,
  input: { gridRunId: string; rowNumber: number; subjectRef: SubjectRef },
): Promise<string> {
  const result = await db.query<{ grid_row_id: string }>(
    `insert into grid_rows (grid_run_id, row_number, subject_ref, status)
     values ($1, $2, $3::jsonb, 'pending')
     returning grid_row_id::text as grid_row_id`,
    [input.gridRunId, input.rowNumber, JSON.stringify(input.subjectRef)],
  );
  return result.rows[0].grid_row_id;
}

export async function insertPendingCell(
  db: QueryExecutor,
  input: { gridRowId: string; gridRunId: string; columnKey: string },
): Promise<string> {
  const result = await db.query<{ grid_cell_id: string }>(
    `insert into grid_cells (grid_row_id, grid_run_id, column_key, status)
     values ($1, $2, $3, 'pending')
     returning grid_cell_id::text as grid_cell_id`,
    [input.gridRowId, input.gridRunId, input.columnKey],
  );
  return result.rows[0].grid_cell_id;
}

export async function updateCellResult(
  db: QueryExecutor,
  input: CellWrite & { gridRowId: string; columnKey: string },
): Promise<void> {
  const result = await db.query(
    `update grid_cells
        set status = $3,
            display = $4::jsonb,
            snapshot_id = $5,
            primary_ref = $6::jsonb,
            coverage_flag = $7,
            computed_at = now()
      where grid_row_id = $1 and column_key = $2`,
    [
      input.gridRowId,
      input.columnKey,
      input.status,
      JSON.stringify(input.display),
      input.snapshotId,
      input.primaryRef === null ? null : JSON.stringify(input.primaryRef),
      input.coverageFlag,
    ],
  );
  // Fail fast: the cell row is always pre-inserted (insertPendingCell) before a
  // result is written, so a zero-row update signals a logic bug (wrong refs),
  // not a benign no-op — surface it instead of silently dropping the result.
  if ((result.rowCount ?? 0) === 0) {
    throw new Error(
      `updateCellResult matched no cell for grid_row_id=${input.gridRowId} column_key=${input.columnKey}`,
    );
  }
}

// ---- Run progress + detail (Plan 2) ----

export type RunStatus = "pending" | "running" | "partial" | "completed" | "failed";
export type RowStatus = "pending" | "resolved" | "failed";

export type GridRunRow = {
  grid_run_id: string;
  grid_id: string;
  user_id: string;
  status: RunStatus;
  as_of: string;
  cell_total: number;
  cell_done: number;
  dropped_row_count: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
};

const RUN_COLUMNS = `grid_run_id::text as grid_run_id,
       grid_id::text as grid_id,
       user_id::text as user_id,
       status, as_of, cell_total, cell_done, dropped_row_count,
       error_message, started_at, completed_at`;

type GridRunDbRow = {
  grid_run_id: string;
  grid_id: string;
  user_id: string;
  status: RunStatus;
  as_of: Date | string;
  cell_total: number | string;
  cell_done: number | string;
  dropped_row_count: number | string;
  error_message: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
};

function runFromDb(row: GridRunDbRow): GridRunRow {
  return {
    grid_run_id: row.grid_run_id,
    grid_id: row.grid_id,
    user_id: row.user_id,
    status: row.status,
    as_of: iso(row.as_of),
    cell_total: Number(row.cell_total),
    cell_done: Number(row.cell_done),
    dropped_row_count: Number(row.dropped_row_count),
    error_message: row.error_message ?? null,
    started_at: iso(row.started_at),
    completed_at: row.completed_at == null ? null : iso(row.completed_at),
  };
}

// Returns the run only when it belongs to userId — the ownership guard for the
// GET endpoint (grid_runs.user_id is denormalized so no join is needed).
export async function loadRunForUser(
  db: QueryExecutor,
  userId: string,
  runId: string,
): Promise<GridRunRow | null> {
  const result = await db.query<GridRunDbRow>(
    `select ${RUN_COLUMNS} from grid_runs where grid_run_id = $1 and user_id = $2`,
    [runId, userId],
  );
  return result.rows[0] ? runFromDb(result.rows[0]) : null;
}

export async function setRunStatus(
  db: QueryExecutor,
  runId: string,
  status: RunStatus,
  opts: { completedAt?: boolean; errorMessage?: string } = {},
): Promise<void> {
  await db.query(
    `update grid_runs
        set status = $2,
            completed_at = case when $3 then now() else completed_at end,
            error_message = coalesce($4, error_message)
      where grid_run_id = $1`,
    [runId, status, opts.completedAt === true, opts.errorMessage ?? null],
  );
}

export async function markRowResolved(
  db: QueryExecutor,
  gridRowId: string,
  period: Record<string, unknown> | null,
): Promise<void> {
  await db.query(
    `update grid_rows set status = 'resolved', period_context = $2::jsonb where grid_row_id = $1`,
    [gridRowId, period === null ? null : JSON.stringify(period)],
  );
}

export async function markRowFailed(db: QueryExecutor, gridRowId: string): Promise<void> {
  await db.query(`update grid_rows set status = 'failed' where grid_row_id = $1`, [gridRowId]);
}

// Atomic single-increment. The run engine bumps exactly once per cell, so the
// (cell_done <= cell_total) CHECK on grid_runs is a fail-fast backstop: a
// double-bump would raise a constraint error (a logic bug surfaced, not capped).
export async function bumpCellDone(db: QueryExecutor, runId: string): Promise<void> {
  await db.query(`update grid_runs set cell_done = cell_done + 1 where grid_run_id = $1`, [runId]);
}

export type GridRowDetail = {
  grid_row_id: string;
  row_number: number;
  subject_ref: SubjectRef;
  // The issuer's legal name for display; null for non-issuer rows or when the
  // issuer row is gone. The UI falls back to the raw id.
  subject_label: string | null;
  period_context: Record<string, unknown> | null;
  status: RowStatus;
};

export type GridCellDetail = {
  grid_cell_id: string;
  grid_row_id: string;
  column_key: string;
  status: CellStatus;
  display: CellDisplay | null;
  snapshot_id: string | null;
  primary_ref: CellRef | null;
  coverage_flag: string | null;
};

export type GridRunDetail = { run: GridRunRow; rows: GridRowDetail[]; cells: GridCellDetail[] };

export async function getRunDetail(db: QueryExecutor, runId: string): Promise<GridRunDetail> {
  const runRes = await db.query<GridRunDbRow>(`select ${RUN_COLUMNS} from grid_runs where grid_run_id = $1`, [runId]);
  if (!runRes.rows[0]) throw new GridNotFoundError("grid run not found");
  const rowsRes = await db.query(
    `select gr.grid_row_id::text as grid_row_id, gr.row_number, gr.subject_ref, gr.period_context, gr.status,
            i.legal_name as subject_label
       from grid_rows gr
       left join issuers i
         on gr.subject_ref->>'kind' = 'issuer'
        and i.issuer_id::text = gr.subject_ref->>'id'
      where gr.grid_run_id = $1 order by gr.row_number asc`,
    [runId],
  );
  const cellsRes = await db.query(
    `select grid_cell_id::text as grid_cell_id, grid_row_id::text as grid_row_id, column_key,
            status, display, snapshot_id::text as snapshot_id, primary_ref, coverage_flag
       from grid_cells where grid_run_id = $1`,
    [runId],
  );
  return {
    run: runFromDb(runRes.rows[0]),
    rows: rowsRes.rows.map((r) => ({
      grid_row_id: String(r.grid_row_id),
      row_number: Number(r.row_number),
      subject_ref: r.subject_ref as SubjectRef,
      subject_label: (r.subject_label as string | null) ?? null,
      period_context: (r.period_context as Record<string, unknown> | null) ?? null,
      status: r.status as RowStatus,
    })),
    cells: cellsRes.rows.map((c) => ({
      grid_cell_id: String(c.grid_cell_id),
      grid_row_id: String(c.grid_row_id),
      column_key: String(c.column_key),
      status: c.status as CellStatus,
      display: (c.display as GridCellDetail["display"]) ?? null,
      snapshot_id: (c.snapshot_id as string | null) ?? null,
      primary_ref: (c.primary_ref as GridCellDetail["primary_ref"]) ?? null,
      coverage_flag: (c.coverage_flag as string | null) ?? null,
    })),
  };
}
