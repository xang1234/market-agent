// 0049 (verified memo sections) and 0050 (frozen grid runs, certified grid
// cells) cycle cleanly, preserve legacy grid cells, and refuse to drop
// certified history.

import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyFrozenBase, applyMigration, catalogSnapshot, createDatabase, startServer } from "./financial-migration-helpers.ts";

const USER = "4f000000-0000-4000-8000-000000000001";

test("0049/0050 verified surface migrations", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for financial migration coverage");
    return;
  }
  const server = await startServer(t, "fin-surface-0050");

  await t.test("down then up cycles cleanly on an empty database", async (t) => {
    const cycle = await createDatabase(t, server, "cycle_0050");
    await applyFrozenBase(cycle);
    for (const version of ["0046", "0047", "0048"]) await applyMigration(cycle, version, "up");
    const base = await catalogSnapshot(cycle);
    await applyMigration(cycle, "0049", "up");
    await applyMigration(cycle, "0050", "up");
    const migrated = await catalogSnapshot(cycle);
    await applyMigration(cycle, "0050", "down");
    await applyMigration(cycle, "0049", "down");
    assert.deepEqual(await catalogSnapshot(cycle), base);
    await applyMigration(cycle, "0049", "up");
    await applyMigration(cycle, "0050", "up");
    assert.deepEqual(await catalogSnapshot(cycle), migrated);
  });

  await t.test("legacy grid cells keep their column as their instance; repeated instances block the down migration", async (t) => {
    const db = await createDatabase(t, server, "grid_0050");
    await applyFrozenBase(db);
    for (const version of ["0046", "0047", "0048", "0049"]) await applyMigration(db, version, "up");
    const ids = (await db.query(`
      with u as (insert into users (user_id, email) values ('${USER}', 'grid@example.test') returning user_id),
           g as (insert into research_grids (user_id, name, universe_spec, column_specs) select user_id, 'g', '{}'::jsonb, '[]'::jsonb from u returning grid_id, user_id),
           r as (insert into grid_runs (grid_id, user_id, status, as_of, cell_total) select grid_id, user_id, 'completed', now(), 2 from g returning grid_run_id),
           w as (insert into grid_rows (grid_run_id, row_number, subject_ref, status) select grid_run_id, 0, '{}'::jsonb, 'resolved' from r returning grid_row_id, grid_run_id)
      insert into grid_cells (grid_row_id, grid_run_id, column_key, status) select grid_row_id, grid_run_id, 'latest_revenue', 'ok' from w
      returning grid_row_id::text, grid_run_id::text`)).rows[0] as { grid_row_id: string; grid_run_id: string };
    await applyMigration(db, "0050", "up");
    assert.equal((await db.query(`select column_instance_id from grid_cells`)).rows[0].column_instance_id, "latest_revenue");

    await db.query(
      `insert into grid_cells (grid_row_id, grid_run_id, column_key, column_instance_id, status) values ($1, $2, 'latest_revenue', 'c1', 'pending')`,
      [ids.grid_row_id, ids.grid_run_id],
    );
    await assert.rejects(() => applyMigration(db, "0050", "down"), /repeated column instances/);
    await assert.rejects(
      () => db.query(`update grid_cells set financial_run_id = gen_random_uuid() where column_instance_id = 'c1'`),
      /grid_cells_financial_lineage/,
      "a certified cell carries its unit, certificate, snapshot, and block together",
    );
  });
});
