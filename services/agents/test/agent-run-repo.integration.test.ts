import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { Pool } from "pg";

import {
  claimAgentRun,
} from "../src/agent-run-repo.ts";

const RUN_ID_A = "11111111-1111-4111-8111-111111111111";
const RUN_ID_B = "11111111-1111-4111-8111-111111111112";
const RUN_ID_C = "11111111-1111-4111-8111-111111111113";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ROOT = join(import.meta.dirname, "..", "..", "..");
const DB_ROOT = join(WORKSPACE_ROOT, "db");

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? WORKSPACE_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    timeout: 5000,
  });
}

function dockerAvailable(): boolean {
  return run("docker", ["version", "--format", "{{.Server.Version}}"]).status === 0;
}

function containerName(prefix: string): string {
  return `${prefix}-${process.pid}-${Date.now()}`;
}

function stopPostgres(name: string): void {
  run("docker", ["rm", "--force", name]);
}

function startPostgres(name: string): string | null {
  const result = run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-p",
    "127.0.0.1::5432",
    "postgres:15",
  ]);
  if (result.status !== 0) return null;
  const port = run("docker", ["port", name, "5432/tcp"]);
  assert.equal(port.status, 0, port.stderr || port.stdout);
  const match = port.stdout.trim().match(/:(\d+)$/);
  assert.ok(match, `expected docker port output to include a host port, got: ${port.stdout}`);
  return match[1];
}

async function waitForPostgres(name: string, databaseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = run("docker", ["exec", name, "pg_isready", "-U", "postgres"]);
    if (ready.status === 0) {
      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      try {
        await pool.query("select 1");
      } finally {
        await pool.end();
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.fail(`Timed out waiting for Postgres container ${name}`);
}

async function bootstrapDatabase(t: TestContext, prefix: string): Promise<{ databaseUrl: string }> {
  const name = containerName(prefix);
  t.after(() => stopPostgres(name));
  const hostPort = startPostgres(name);
  if (hostPort === null) {
    t.skip("Docker is present but Postgres container did not start");
    return { databaseUrl: "" };
  }
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${hostPort}/postgres`;
  await waitForPostgres(name, databaseUrl);
  const apply = run("npm", ["run", "apply:schema", "--", "--database-url", databaseUrl], {
    cwd: DB_ROOT,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(apply.status, 0, apply.stderr || apply.stdout);
  return { databaseUrl };
}

async function connectedPool(t: TestContext, databaseUrl: string, max = 4): Promise<Pool> {
  const pool = new Pool({ connectionString: databaseUrl, max });
  t.after(() => pool.end().catch(() => {}));
  return pool;
}

test(
  "claimAgentRun enforces one active run per agent in Postgres",
  { skip: !dockerAvailable(), timeout: 120000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "agent-run-claims");
    if (databaseUrl === "") return;
    const pool = await connectedPool(t, databaseUrl, 4);

    const [claimA, claimB] = await Promise.all([
      claimAgentRun(pool, {
        run_id: RUN_ID_A,
        agent_id: AGENT_ID,
        lease_expires_at: "2026-05-04T01:00:00.000Z",
      }),
      claimAgentRun(pool, {
        run_id: RUN_ID_B,
        agent_id: AGENT_ID,
        lease_expires_at: "2026-05-04T01:00:00.000Z",
      }),
    ]);

    const claimed = [claimA, claimB].filter((claim) => claim.claimed);
    const blocked = [claimA, claimB].filter(
      (claim) => !claim.claimed && claim.reason === "concurrency_limit",
    );
    assert.equal(claimed.length, 1);
    assert.equal(blocked.length, 1);

    const count = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from agent_run_logs
        where agent_id = $1::uuid
          and status = 'running'
          and ended_at is null`,
      [AGENT_ID],
    );
    assert.equal(count.rows[0].count, "1");
  },
);

test(
  "claimAgentRun expires stale active runs before claiming a new run",
  { skip: !dockerAvailable(), timeout: 120000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "agent-run-stale");
    if (databaseUrl === "") return;
    const pool = await connectedPool(t, databaseUrl);

    await pool.query(
      `insert into agent_run_logs
         (agent_run_log_id, agent_id, status, claim_expires_at)
       values ($1::uuid, $2::uuid, 'running', now() - interval '1 minute')`,
      [RUN_ID_A, AGENT_ID],
    );

    const claim = await claimAgentRun(pool, {
      run_id: RUN_ID_C,
      agent_id: AGENT_ID,
      lease_expires_at: "2026-05-04T01:00:00.000Z",
    });

    assert.equal(claim.claimed, true);
    const rows = await pool.query<{ agent_run_log_id: string; status: string; ended_at: string | null }>(
      `select agent_run_log_id::text, status, ended_at::text
         from agent_run_logs
        where agent_id = $1::uuid
        order by agent_run_log_id`,
      [AGENT_ID],
    );
    assert.deepEqual(
      rows.rows.map((row) => ({ id: row.agent_run_log_id, status: row.status, ended: row.ended_at !== null })),
      [
        { id: RUN_ID_A, status: "failed", ended: true },
        { id: RUN_ID_C, status: "running", ended: false },
      ],
    );
  },
);
