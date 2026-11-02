import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

import { logPoolErrors } from "../../services/shared/src/pool-client.ts";

import { bootstrapDatabase, connectedClient, dockerAvailable, registerLifoCleanup } from "./docker-pg.ts";

test("a pool whose idle client loses its connection keeps the process running and serves the next query", { timeout: 120_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for the lost idle connection coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "pool-idle-lost");
  const pool = logPoolErrors(new Pool({ connectionString: databaseUrl, max: 2 }));
  const logged = t.mock.method(console, "error", () => {});
  registerLifoCleanup(t, () => pool.end().catch(() => {}));
  const admin = await connectedClient(t, databaseUrl);

  const idle = await pool.connect();
  const { rows } = await idle.query<{ pid: number }>("select pg_backend_pid() as pid");
  idle.release();
  assert.equal(pool.idleCount, 1);

  await admin.query("select pg_terminate_backend($1)", [rows[0]!.pid]);
  for (let waited = 0; pool.totalCount > 0 && waited < 5_000; waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.equal(pool.totalCount, 0, "the dead idle client left the pool");
  assert.deepEqual(
    logged.mock.calls.map((call) => call.arguments),
    [["pg pool: idle client error: terminating connection due to administrator command (code 57P01)"]],
  );
  assert.deepEqual((await pool.query("select 1 as one")).rows, [{ one: 1 }]);
});
