import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { completeAgentRunLog, startAgentRunLog } from "../src/agent-run.ts";
import type { QueryExecutor } from "../src/types.ts";

test("startAgentRunLog seeds a running row indexed by agent_id + started_at", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-hyz-1-1");
  const client = await connectedClient(t, databaseUrl);
  const agent_id = randomUUID();

  const { agent_run_log_id, started_at } = await startAgentRunLog(client, {
    agent_id,
    inputs_watermark: { last_doc_ts: "2026-04-01T00:00:00Z", source_ids: ["sec-edgar"] },
  });

  assert.match(agent_run_log_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(started_at instanceof Date);

  const { rows } = await client.query(
    `select agent_id, status, ended_at, duration_ms,
            inputs_watermark, outputs_summary, error
       from agent_run_logs where agent_run_log_id = $1`,
    [agent_run_log_id],
  );
  assert.deepEqual(rows[0], {
    agent_id,
    status: "running",
    ended_at: null,
    duration_ms: null,
    inputs_watermark: { last_doc_ts: "2026-04-01T00:00:00Z", source_ids: ["sec-edgar"] },
    outputs_summary: null,
    error: null,
  });
});

test("startAgentRunLog accepts an empty input and writes nullable fields as SQL NULL", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-hyz-1-1");
  const client = await connectedClient(t, databaseUrl);

  const { agent_run_log_id } = await startAgentRunLog(client);

  const { rows } = await client.query(
    `select agent_id, inputs_watermark, status from agent_run_logs where agent_run_log_id = $1`,
    [agent_run_log_id],
  );
  assert.deepEqual(rows[0], { agent_id: null, inputs_watermark: null, status: "running" });
});

test("completeAgentRunLog records terminal outcome, outputs summary, and a non-negative duration", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-hyz-1-1");
  const client = await connectedClient(t, databaseUrl);
  const agent_id = randomUUID();
  const { agent_run_log_id, started_at } = await startAgentRunLog(client, { agent_id });

  await sleep(20);

  const completion = await completeAgentRunLog(client, {
    agent_run_log_id,
    status: "ok",
    outputs_summary: { findings: 3, verifier_fails: 0 },
  });

  assert.equal(completion.status, "ok");
  assert.ok(completion.ended_at instanceof Date);
  assert.ok(completion.ended_at.getTime() >= started_at.getTime());
  assert.ok(completion.duration_ms >= 0);

  const { rows } = await client.query(
    `select status, error, outputs_summary, duration_ms
       from agent_run_logs where agent_run_log_id = $1`,
    [agent_run_log_id],
  );
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[0].error, null);
  assert.deepEqual(rows[0].outputs_summary, { findings: 3, verifier_fails: 0 });
  assert.equal(rows[0].duration_ms, completion.duration_ms);
});

test("completeAgentRunLog with explicit ended_at computes duration deterministically", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-hyz-1-1");
  const client = await connectedClient(t, databaseUrl);

  const { rows: seed } = await client.query<{ agent_run_log_id: string }>(
    `insert into agent_run_logs (started_at) values ($1::timestamptz)
     returning agent_run_log_id`,
    ["2026-01-01T00:00:00Z"],
  );

  const completion = await completeAgentRunLog(client, {
    agent_run_log_id: seed[0].agent_run_log_id,
    status: "error",
    error: "watermark stale",
    ended_at: new Date("2026-01-01T00:00:01.250Z"),
  });

  assert.equal(completion.duration_ms, 1250);
  assert.equal(completion.status, "error");

  const { rows } = await client.query(
    `select error, duration_ms from agent_run_logs where agent_run_log_id = $1`,
    [seed[0].agent_run_log_id],
  );
  assert.equal(rows[0].error, "watermark stale");
  assert.equal(rows[0].duration_ms, 1250);
});

test("completeAgentRunLog throws when the run id does not exist", async () => {
  const db: QueryExecutor = {
    query: async () => ({ rows: [], rowCount: 0, command: "UPDATE", oid: 0, fields: [] }) as never,
  };

  await assert.rejects(
    completeAgentRunLog(db, { agent_run_log_id: randomUUID(), status: "ok" }),
    /agent_run_log not found/i,
  );
});
