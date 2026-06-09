import test from "node:test";
import assert from "node:assert/strict";
import type { QueryResult } from "pg";

import { createGrid, getGrid, listGrids } from "../src/queries.ts";
import { GridNotFoundError, type QueryExecutor } from "../src/types.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const GRID_ID = "22222222-2222-4222-a222-222222222222";

type Captured = { text: string; values?: unknown[] };

function fakeDb(responder: (text: string, values?: unknown[]) => unknown[]): {
  db: QueryExecutor;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return { rows: responder(text, values) as R[], rowCount: 0, command: "", oid: 0, fields: [] } satisfies QueryResult<R>;
    },
  };
  return { db, queries };
}

const GRID_DB_ROW = {
  grid_id: GRID_ID,
  user_id: USER_ID,
  name: "AI capex exposure",
  description: null,
  universe_spec: { source: "manual", subject_refs: [] },
  column_specs: [{ column_key: "latest_market_cap" }],
  created_at: "2026-06-09T00:00:00.000Z",
  updated_at: "2026-06-09T00:00:00.000Z",
};

test("createGrid inserts and returns the grid row", async () => {
  const { db, queries } = fakeDb((text) => (text.startsWith("insert") ? [GRID_DB_ROW] : []));
  const grid = await createGrid(db, USER_ID, {
    name: "AI capex exposure",
    universe_spec: { source: "manual", subject_refs: [] },
    column_specs: [{ column_key: "latest_market_cap" }],
  });
  assert.equal(grid.grid_id, GRID_ID);
  assert.equal(grid.name, "AI capex exposure");
  assert.ok(queries[0].text.startsWith("insert into research_grids"));
});

test("getGrid throws GridNotFoundError when the grid is missing or not owned", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(() => getGrid(db, USER_ID, GRID_ID), GridNotFoundError);
});

test("listGrids returns the user's grids", async () => {
  const { db } = fakeDb(() => [GRID_DB_ROW]);
  const grids = await listGrids(db, USER_ID);
  assert.equal(grids.length, 1);
  assert.equal(grids[0].grid_id, GRID_ID);
});
