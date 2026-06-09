import {
  GridNotFoundError,
  type CellStatus,
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
  input: {
    gridRowId: string;
    columnKey: string;
    status: CellStatus;
    display: { value: string; tone: "best" | "worst" | null } | null;
    snapshotId: string | null;
    primaryRef: { kind: "fact" | "claim"; id: string } | null;
    coverageFlag: string | null;
  },
): Promise<void> {
  await db.query(
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
      input.display === null ? null : JSON.stringify(input.display),
      input.snapshotId,
      input.primaryRef === null ? null : JSON.stringify(input.primaryRef),
      input.coverageFlag,
    ],
  );
}
