import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { writeToolCallLog } from "../src/tool-call.ts";

test("writeToolCallLog persists a full row and returns the generated id", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-8-2");
  const client = await connectedClient(t, databaseUrl);
  const thread_id = randomUUID();
  const agent_id = randomUUID();

  const { tool_call_id, created_at } = await writeToolCallLog(client, {
    thread_id,
    agent_id,
    tool_name: "resolver.resolveByTicker",
    args: { text: "AAPL", mic: "XNAS" },
    result_hash: "sha256:abc",
    duration_ms: 42,
    status: "ok",
  });

  assert.match(tool_call_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(created_at instanceof Date);

  const { rows } = await client.query(
    `select tool_call_id, thread_id, agent_id, tool_name, args, result_hash, duration_ms, status, error_code
     from tool_call_logs where tool_call_id = $1`,
    [tool_call_id],
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    tool_call_id,
    thread_id,
    agent_id,
    tool_name: "resolver.resolveByTicker",
    args: { text: "AAPL", mic: "XNAS" },
    result_hash: "sha256:abc",
    duration_ms: 42,
    status: "ok",
    error_code: null,
  });
});

test("writeToolCallLog omits optional fields when not provided", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-8-2");
  const client = await connectedClient(t, databaseUrl);

  const { tool_call_id } = await writeToolCallLog(client, {
    tool_name: "resolver.resolveByCik",
    args: [],
    status: "error",
  });

  const { rows } = await client.query(
    `select thread_id, agent_id, result_hash, duration_ms, error_code, args
     from tool_call_logs where tool_call_id = $1`,
    [tool_call_id],
  );
  assert.deepEqual(rows[0], {
    thread_id: null,
    agent_id: null,
    result_hash: null,
    duration_ms: null,
    error_code: null,
    args: [],
  });
});
