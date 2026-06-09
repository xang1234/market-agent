import {
  GridNotFoundError,
  type CreateGridInput,
  type QueryExecutor,
  type ResearchGridRow,
} from "./types.ts";

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
