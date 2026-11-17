import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type { Pool } from "pg";

import { createAgent, getAgent } from "../../agents/src/agent-repo.ts";
import type { AgentLoopStages } from "../../agents/src/agent-loop.ts";
import { getCurrentThesis, loadThesisHistory, saveThesis } from "../../agents/src/thesis-repo.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { databaseUrl, engineDatabase, IDS, seedReportedFact } from "../../financial-engine/test/db-fixtures.ts";
import { writeRunActivity } from "../../observability/src/run-activity.ts";
import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { startAgentScheduler } from "../src/agent-scheduler.ts";
import { createServiceDevApiAdapters, type DevApiAgentLoopStageFactory } from "../src/http.ts";
import { createThesisAgentLoopStages } from "../src/thesis-runtime.ts";

const USER_ID = IDS.owner;
const ISSUER = { kind: "issuer" as const, id: IDS.issuerA };
const LAST_FISCAL_YEAR = new Date().getUTCFullYear() - 1;
const docker = { skip: !dockerAvailable(), timeout: 120_000 };

type Gate = { open(): void; reached: Promise<void>; hold(): Promise<void> };

function gate(): Gate {
  let open!: () => void;
  let arrive!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  const reached = new Promise<void>((resolve) => { arrive = resolve; });
  return { open, reached, hold: async () => { arrive(); await opened; } };
}

// Ages a run past its lease, and its start by `hours`, so the next claim may take it over.
async function expireLease(pool: Pool, runId: string, hours = 0): Promise<void> {
  await pool.query(
    `update agent_run_logs
        set claim_expires_at = now() - interval '1 second',
            started_at = started_at - make_interval(hours => $2::int)
      where agent_run_log_id = $1::uuid`,
    [runId, hours],
  );
}

async function lastRunTwoHoursAgo(pool: Pool, agentId: string): Promise<void> {
  await pool.query(
    `insert into agent_run_logs (agent_id, started_at, ended_at, status, outputs_summary)
     values ($1::uuid, now() - interval '2 hours', now() - interval '2 hours', 'completed', '{}'::jsonb)`,
    [agentId],
  );
}

// Stages whose effect and watermark name the run, the first run held at `analyze` until its gate opens.
function markingRuns() {
  const first = gate();
  const runIds: string[] = [];
  const createAgentLoopStages: DevApiAgentLoopStageFactory = ({ userId, runId }) => {
    runIds.push(runId);
    const hold = runIds.length === 1 ? first.hold : async () => {};
    return {
      readDeltas: async () => ({}),
      extractEvidence: async () => ({}),
      clusterEvidence: async () => ({}),
      analyze: async () => { await hold(); return {}; },
      nextWatermarks: async () => ({ last_run_id: runId }),
      applySideEffects: async ({ tx, agent_id }) => {
        await writeRunActivity(tx, { user_id: userId, agent_id, stage: "found", subject_refs: [], summary: `effect of ${runId}` });
        return { findings: 1 };
      },
    } satisfies AgentLoopStages;
  };
  return { first, runIds, createAgentLoopStages };
}

// The real thesis stages, each run held after `analyze` at its gate, in claim order.
function thesisRuns(pool: Pool, gates: Gate[]) {
  const runIds: string[] = [];
  const createAgentLoopStages: DevApiAgentLoopStageFactory = async ({ userId, runId, agent }) => {
    const held = gates[runIds.length];
    runIds.push(runId);
    const thesis = await getCurrentThesis(pool, agent.agent_id);
    assert.ok(thesis, "the agent has a saved thesis");
    const stages = createThesisAgentLoopStages({ db: pool, userId, runId, agent, thesis, financial: { pool, evidence: createEvidenceFinancialPort } });
    if (held === undefined) return stages;
    const analyze = stages.analyze;
    return { ...stages, analyze: async (input: Parameters<typeof analyze>[0]) => { const result = await analyze(input); await held.hold(); return result; } };
  };
  return { runIds, createAgentLoopStages };
}

async function plainAgent(t: TestContext, prefix: string): Promise<{ pool: Pool; agentId: string }> {
  const { databaseUrl: url } = await bootstrapDatabase(t, prefix);
  const pool = await connectedPool(t, url);
  await pool.query(`insert into users (user_id, email) values ($1::uuid, 'lease@example.com')`, [USER_ID]);
  const agent = await createAgent(pool, { user_id: USER_ID, name: "Hourly", thesis: "Watch margins.", cadence: "hourly", universe: { mode: "static", subject_refs: [] } });
  await lastRunTwoHoursAgo(pool, agent.agent_id);
  return { pool, agentId: agent.agent_id };
}

async function thesisAgent(t: TestContext, prefix: string) {
  const db = await engineDatabase(t, prefix);
  const pool = await connectedPool(t, databaseUrl(db));
  const agent = await createAgent(db, { user_id: USER_ID, name: "Gross profit monitor", thesis: "Gross profit remains strong.", cadence: "hourly", universe: { mode: "static", subject_refs: [ISSUER] } });
  await saveThesis(db, {
    agent_id: agent.agent_id, user_id: USER_ID, expected_version: 0, thesis: agent.thesis, subject_ref: ISSUER,
    conditions: [{
      condition_id: "30000000-0000-4000-8000-000000000001", statement: "Gross profit remains strong.", falsifier: "Gross profit falls below the required floor.", horizon: "Next year",
      metric: { metric_key: "gross_profit", unit: "currency", period_kind: "fiscal_y", operator: "gte", threshold: "150000000000", max_age_days: 730 },
    }],
  });
  const fact = await seedReportedFact(db, { metric_key: "gross_profit", value: "169148000000", fiscal_year: LAST_FISCAL_YEAR });
  await lastRunTwoHoursAgo(pool, agent.agent_id);
  return { db, pool, agentId: agent.agent_id, fact };
}

// Names each run by its role, so expectations stay literal.
function byRole<T>(value: T, roles: Record<string, string>): T {
  let text = JSON.stringify(value);
  for (const [runId, role] of Object.entries(roles)) text = text.replaceAll(runId, role);
  return JSON.parse(text) as T;
}

async function runStates(pool: Pool, runIds: string[]) {
  const { rows } = await pool.query<{ id: string; status: string; error: string | null }>(
    `select agent_run_log_id::text as id, status, error from agent_run_logs where agent_run_log_id = any($1::uuid[])`,
    [runIds],
  );
  return Object.fromEntries(rows.map((row) => [row.id, { status: row.status, error: row.error }]));
}

async function effects(pool: Pool, agentId: string): Promise<string[]> {
  const { rows } = await pool.query<{ summary: string }>(`select summary from run_activities where agent_id = $1 order by ts, summary`, [agentId]);
  return rows.map((row) => row.summary);
}

const runView = (run: { status: string; error: string | null } | null | string) =>
  typeof run === "string" || run === null ? run : { status: run.status, error: run.error };

test("a scheduled run that lost its lease to a newer run commits nothing and ends superseded", docker, async (t) => {
  const { pool, agentId } = await plainAgent(t, "dev-api-agent-lease-scheduled");
  const runs = markingRuns();
  const stale = startAgentScheduler({ db: pool, createAgentLoopStages: runs.createAgentLoopStages, log: () => {} }, 3_600_000);
  const fresh = startAgentScheduler({ db: pool, createAgentLoopStages: runs.createAgentLoopStages, log: () => {} }, 3_600_000);
  t.after(() => Promise.all([stale.stop(), fresh.stop()]));

  const staleTick = stale.tick();
  await runs.first.reached;
  await expireLease(pool, runs.runIds[0], 2);
  const newer = await fresh.tick();
  runs.first.open();
  const staleResults = await staleTick;

  assert.deepEqual(byRole({
    stale: staleResults.map((result) => result.status),
    newer: newer.map((result) => result.status),
    watermarks: (await getAgent(pool, agentId))?.watermarks,
    effects: await effects(pool, agentId),
    runs: await runStates(pool, runs.runIds),
  }, { [runs.runIds[0]]: "stale", [runs.runIds[1]]: "newer" }), {
    stale: ["superseded"],
    newer: ["completed"],
    watermarks: { last_run_id: "newer" },
    effects: ["effect of newer"],
    runs: { newer: { status: "completed", error: null }, stale: { status: "failed", error: "agent run claim expired" } },
  });
});

test("a run-now that lost its lease to a newer run commits nothing and returns its superseded run", docker, async (t) => {
  const { pool, agentId } = await plainAgent(t, "dev-api-agent-lease-run-now");
  const runs = markingRuns();
  const adapters = createServiceDevApiAdapters({ db: pool, createAgentLoopStages: runs.createAgentLoopStages } as never);

  const staleRun = adapters.agents.run({ userId: USER_ID, agentId });
  await runs.first.reached;
  await expireLease(pool, runs.runIds[0]);
  const newer = await adapters.agents.run({ userId: USER_ID, agentId });
  runs.first.open();
  const stale = await staleRun.catch((error: Error) => error.message);

  assert.deepEqual(byRole({
    stale: runView(stale),
    newer: runView(newer),
    watermarks: (await getAgent(pool, agentId))?.watermarks,
    effects: await effects(pool, agentId),
  }, { [runs.runIds[0]]: "stale", [runs.runIds[1]]: "newer" }), {
    stale: { status: "failed", error: "agent run claim expired" },
    newer: { status: "completed", error: null },
    watermarks: { last_run_id: "newer" },
    effects: ["effect of newer"],
  });
});

test("a thesis run that lost its lease records no stale assessment while the newer run is in flight", docker, async (t) => {
  const { db, pool, agentId, fact } = await thesisAgent(t, "dev-api-agent-lease-thesis-in-flight");
  const gates = [gate(), gate()];
  const runs = thesisRuns(pool, gates);
  const adapters = createServiceDevApiAdapters({ db: pool, createAgentLoopStages: runs.createAgentLoopStages } as never);

  const staleRun = adapters.agents.run({ userId: USER_ID, agentId });
  await gates[0].reached;
  await db.query("update facts set invalidated_at = now() where fact_id = $1", [fact]);
  await seedReportedFact(db, { metric_key: "gross_profit", value: "100000000000", fiscal_year: LAST_FISCAL_YEAR });
  await expireLease(pool, runs.runIds[0]);
  const newerRun = adapters.agents.run({ userId: USER_ID, agentId });
  await gates[1].reached;
  gates[0].open();
  const stale = await staleRun.catch((error: Error) => error.message);
  gates[1].open();
  const newer = await newerRun;

  const history = await loadThesisHistory(pool, { agent_id: agentId, user_id: USER_ID });
  const watermarks = (await getAgent(pool, agentId))?.watermarks as { thesis_monitor?: { input_hash: string } };
  assert.deepEqual(byRole({
    stale: runView(stale),
    newer: runView(newer),
    assessments: history.assessments.map((assessment) => ({ run: assessment.run_id, status: assessment.results[0].status })),
    watermark: watermarks.thesis_monitor?.input_hash.split("/")[1],
  }, { [runs.runIds[0]]: "stale", [runs.runIds[1]]: "newer" }), {
    stale: { status: "failed", error: "agent run claim expired" },
    newer: { status: "completed", error: null },
    assessments: [{ run: "newer", status: "challenged" }],
    watermark: "newer",
  });
});

test("a scheduled thesis run that lost its lease leaves the newer assessment's watermark in place", docker, async (t) => {
  const { pool, agentId } = await thesisAgent(t, "dev-api-agent-lease-thesis-after");
  const gates = [gate()];
  const runs = thesisRuns(pool, gates);
  const stale = startAgentScheduler({ db: pool, createAgentLoopStages: runs.createAgentLoopStages, log: () => {} }, 3_600_000);
  const fresh = startAgentScheduler({ db: pool, createAgentLoopStages: runs.createAgentLoopStages, log: () => {} }, 3_600_000);
  t.after(() => Promise.all([stale.stop(), fresh.stop()]));

  const staleTick = stale.tick();
  await gates[0].reached;
  await expireLease(pool, runs.runIds[0], 2);
  const newer = await fresh.tick();
  gates[0].open();
  const staleResults = await staleTick;

  const history = await loadThesisHistory(pool, { agent_id: agentId, user_id: USER_ID });
  const watermarks = (await getAgent(pool, agentId))?.watermarks as { thesis_monitor?: { input_hash: string } };
  assert.deepEqual(byRole({
    stale: staleResults.map((result) => result.status),
    newer: newer.map((result) => result.status),
    assessments: history.assessments.map((assessment) => ({ run: assessment.run_id, status: assessment.results[0].status })),
    watermark: watermarks.thesis_monitor?.input_hash.split("/")[1],
    dismissals: (await effects(pool, agentId)).filter((summary) => summary.startsWith("No new thesis changes")).length,
  }, { [runs.runIds[0]]: "stale", [runs.runIds[1]]: "newer" }), {
    stale: ["superseded"],
    newer: ["completed"],
    assessments: [{ run: "newer", status: "supported" }],
    watermark: "newer",
    dismissals: 0,
  });
});
