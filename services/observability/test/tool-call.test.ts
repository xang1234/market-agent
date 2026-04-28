import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import {
  hashJsonValue,
  runLoggedToolCall,
  toolCallArgsDigest,
  writeToolCallLog,
} from "../src/tool-call.ts";

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
    result: { subject_ref: { kind: "listing", id: "XNAS:AAPL" } },
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
    args: toolCallArgsDigest({ text: "AAPL", mic: "XNAS" }),
    result_hash: hashJsonValue({ subject_ref: { kind: "listing", id: "XNAS:AAPL" } }),
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
    args: toolCallArgsDigest([]),
  });
});

test("hashJsonValue is stable across object key order and rejects non-json payloads", () => {
  assert.equal(hashJsonValue({ b: 2, a: 1 }), hashJsonValue({ a: 1, b: 2 }));
  assert.match(hashJsonValue({ a: 1 }), /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => hashJsonValue({ bad: Number.NaN } as never), /non-finite/i);
});

test("runLoggedToolCall records a successful tool invocation", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const db = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return {
        rows: [
          {
            tool_call_id: "00000000-0000-4000-8000-000000000001",
            created_at: new Date("2026-04-29T00:00:00.000Z"),
          },
        ] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };
  let now = 100;

  const result = await runLoggedToolCall(db, {
    tool_name: "resolver.resolveByTicker",
    args: { symbol: "AAPL" },
    now: () => {
      now += 25;
      return now;
    },
    invoke: async ({ symbol }) => ({ subject_ref: `${symbol}:XNAS` }),
  });

  assert.deepEqual(result, { subject_ref: "AAPL:XNAS" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].values?.[2], "resolver.resolveByTicker");
  assert.deepEqual(calls[0].values?.[3], JSON.stringify(toolCallArgsDigest({ symbol: "AAPL" })));
  assert.equal(calls[0].values?.[4], hashJsonValue({ subject_ref: "AAPL:XNAS" }));
  assert.equal(calls[0].values?.[5], 25);
  assert.equal(calls[0].values?.[6], "ok");
  assert.equal(calls[0].values?.[7], null);
});

test("runLoggedToolCall records failed tool invocations and rethrows", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const db = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return {
        rows: [
          {
            tool_call_id: "00000000-0000-4000-8000-000000000002",
            created_at: new Date("2026-04-29T00:00:00.000Z"),
          },
        ] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };
  let now = 400;
  const error = Object.assign(new Error("rate limited"), { code: "RATE_LIMITED" });

  await assert.rejects(
    runLoggedToolCall(db, {
      tool_name: "market.quote",
      args: { symbol: "TSLA" },
      now: () => {
        now += 10;
        return now;
      },
      invoke: async () => {
        throw error;
      },
    }),
    /rate limited/,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].values?.[2], "market.quote");
  assert.equal(calls[0].values?.[4], null);
  assert.equal(calls[0].values?.[5], 10);
  assert.equal(calls[0].values?.[6], "error");
  assert.equal(calls[0].values?.[7], "RATE_LIMITED");
});
