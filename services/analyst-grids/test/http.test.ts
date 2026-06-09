import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { QueryResult } from "pg";

import { createAnalystGridsServer } from "../src/http.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const GRID_ID = "22222222-2222-4222-a222-222222222222";

function fakeDb(responder: (text: string) => unknown[]): QueryExecutor {
  return {
    async query<R extends Record<string, unknown>>(text: string) {
      return { rows: responder(text) as R[], rowCount: 0, command: "", oid: 0, fields: [] } satisfies QueryResult<R>;
    },
  };
}

async function startServer(db: QueryExecutor) {
  const server = createAnalystGridsServer(db, { auth: { mode: "dev_user_header" } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

test("GET /v1/analyst-grids/columns returns the catalog", async () => {
  const { server, base } = await startServer(fakeDb(() => []));
  try {
    const res = await fetch(`${base}/v1/analyst-grids/columns`, { headers: { "x-user-id": USER_ID } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { columns: Array<{ column_key: string }> };
    assert.ok(body.columns.some((c) => c.column_key === "latest_market_cap"));
  } finally {
    server.close();
  }
});

test("POST then GET a grid round-trips", async () => {
  const row = {
    grid_id: GRID_ID,
    user_id: USER_ID,
    name: "g",
    description: null,
    universe_spec: { source: "manual", subject_refs: [] },
    column_specs: [{ column_key: "latest_market_cap" }],
    created_at: "2026-06-09T00:00:00.000Z",
    updated_at: "2026-06-09T00:00:00.000Z",
  };
  const { server, base } = await startServer(fakeDb(() => [row]));
  try {
    const created = await fetch(`${base}/v1/analyst-grids`, {
      method: "POST",
      headers: { "x-user-id": USER_ID, "content-type": "application/json" },
      body: JSON.stringify({ name: "g", universe_spec: { source: "manual", subject_refs: [] }, column_specs: [{ column_key: "latest_market_cap" }] }),
    });
    assert.equal(created.status, 201);
    const got = await fetch(`${base}/v1/analyst-grids/${GRID_ID}`, { headers: { "x-user-id": USER_ID } });
    assert.equal(got.status, 200);
  } finally {
    server.close();
  }
});

test("missing x-user-id returns 401", async () => {
  const { server, base } = await startServer(fakeDb(() => []));
  try {
    const res = await fetch(`${base}/v1/analyst-grids`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test("malformed JSON body returns 400 (not 500)", async () => {
  const { server, base } = await startServer(fakeDb(() => []));
  try {
    const res = await fetch(`${base}/v1/analyst-grids`, {
      method: "POST",
      headers: { "x-user-id": USER_ID, "content-type": "application/json" },
      body: "{ not valid json",
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test("unknown universe_spec.source returns 400", async () => {
  const { server, base } = await startServer(fakeDb(() => []));
  try {
    const res = await fetch(`${base}/v1/analyst-grids`, {
      method: "POST",
      headers: { "x-user-id": USER_ID, "content-type": "application/json" },
      body: JSON.stringify({ name: "g", universe_spec: { source: "bogus" }, column_specs: [] }),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});
