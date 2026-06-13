import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { QueryResult } from "pg";
import { createAnalystGridsServer } from "../src/http.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER = "11111111-1111-4111-a111-111111111111";
const RUN = "99999999-9999-4999-a999-999999999999";

function fakeDb(responder: (text: string, values?: unknown[]) => unknown[]): QueryExecutor {
  return {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      const rows = responder(text, values) as R[];
      return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] } satisfies QueryResult<R>;
    },
  };
}

async function withServer(db: QueryExecutor, fn: (base: string) => Promise<void>) {
  const server = createAnalystGridsServer({
    db,
    pool: { connect: async () => { throw new Error("pool unused in this test"); } },
    universe: {
      resolveScreen: async () => [], resolveWatchlist: async () => [], resolvePortfolio: async () => [],
      resolvePeers: async () => [],
    },
    auth: { mode: "dev_user_header" },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test("GET run detail returns 404 when the run is not owned by the user", async () => {
  const db = fakeDb(() => []); // loadRunForUser finds nothing
  await withServer(db, async (base) => {
    const res = await fetch(`${base}/v1/analyst-grids/runs/${RUN}`, { headers: { "x-user-id": USER } });
    assert.equal(res.status, 404);
  });
});

test("GET run detail returns the run + rows + cells for the owner", async () => {
  const runRow = { grid_run_id: RUN, grid_id: "g", user_id: USER, status: "completed", as_of: "2026-06-09T00:00:00.000Z", cell_total: 0, cell_done: 0, dropped_row_count: 0, error_message: null, started_at: "2026-06-09T00:00:00.000Z", completed_at: "2026-06-09T00:01:00.000Z" };
  const db = fakeDb((text) => (text.includes("from grid_runs") ? [runRow] : []));
  await withServer(db, async (base) => {
    const res = await fetch(`${base}/v1/analyst-grids/runs/${RUN}`, { headers: { "x-user-id": USER } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.run.status, "completed");
    assert.deepEqual(body.rows, []);
    assert.deepEqual(body.cells, []);
  });
});

test("POST run requires authentication", async () => {
  const db = fakeDb(() => []);
  await withServer(db, async (base) => {
    const res = await fetch(`${base}/v1/analyst-grids/${RUN}/runs`, { method: "POST" });
    assert.equal(res.status, 401);
  });
});
