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

// Moving started_at back by `hours` makes the scheduler find the agent due again.
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

type HeldStage = "analyze" | "applySideEffects";

function signedRuns(holdAt: ReadonlyArray<HeldStage> = ["analyze"], { failHeld = false } = {}) {
  const gates: Record<HeldStage, Gate> = { analyze: gate(), applySideEffects: gate() };
  const runIds: string[] = [];
  const createAgentLoopStages: DevApiAgentLoopStageFactory = ({ userId, runId }) => {
    runIds.push(runId);
    const first = runIds.length === 1;
    const hold = (stage: HeldStage) => (first && holdAt.includes(stage) ? gates[stage].hold() : Promise.resolve());
    return {
      readDeltas: async () => ({}),
      extractEvidence: async () => ({}),
      clusterEvidence: async () => ({}),
      analyze: async () => {
        await hold("analyze");
        if (first && failHeld) throw new Error("analyze failed");
        return {};
      },
      nextWatermarks: async () => ({ last_run_id: runId }),
      applySideEffects: async ({ tx, agent_id }) => {
        await hold("applySideEffects");
        await writeRunActivity(tx, { user_id: userId, agent_id, stage: "found", subject_refs: [], summary: `effect of ${runId}` });
        return { findings: 1 };
      },
    } satisfies AgentLoopStages;
  };
  return { gates, runIds, createAgentLoopStages };
}

function heldThesisRuns(pool: Pool, gates: Gate[]) {
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

const runView = (run: { agent_run_log_id: string; status: string; error: string | null } | null | string) =>
  typeof run === "string" || run === null ? run : { id: run.agent_run_log_id, status: run.status, error: run.error };

async function landsWithoutWaiting(pool: Pool, change: Promise<unknown>): Promise<boolean> {
  let landed = false;
  change.then(() => { landed = true; }, () => {});
  while (!landed) {
    const { rows: [{ waiting }] } = await pool.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (waiting > 0) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
}

test("a scheduled run that lost its lease to a newer run commits nothing and ends superseded", docker, async (t) => {
  const { pool, agentId } = await plainAgent(t, "dev-api-agent-lease-scheduled");
  const runs = signedRuns();
  const stale = startAgentScheduler({ db: pool, createAgentLoopStages: runs.createAgentLoopStages, log: () => {} }, 3_600_000);
  const fresh = startAgentScheduler({ db: pool, createAgentLoopStages: runs.createAgentLoopStages, log: () => {} }, 3_600_000);
  t.after(() => Promise.all([stale.stop(), fresh.stop()]));

  const staleTick = stale.tick();
  await runs.gates.analyze.reached;
  await expireLease(pool, runs.runIds[0], 2);
  const newer = await fresh.tick();
  runs.gates.analyze.open();
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

test("a scheduled run that fails after losing its lease logs its own error beside superseded", docker, async (t) => {
  const { pool, agentId } = await plainAgent(t, "dev-api-agent-lease-scheduled-failure");
  const runs = signedRuns(["analyze"], { failHeld: true });
  const lines: string[] = [];
  const stale = startAgentScheduler({ db: pool, createAgentLoopStages: runs.createAgentLoopStages, log: (line) => lines.push(line) }, 3_600_000);
  const fresh = startAgentScheduler({ db: pool, createAgentLoopStages: runs.createAgentLoopStages, log: () => {} }, 3_600_000);
  t.after(() => Promise.all([stale.stop(), fresh.stop()]));

  const staleTick = stale.tick();
  await runs.gates.analyze.reached;
  await expireLease(pool, runs.runIds[0], 2);
  await fresh.tick();
  runs.gates.analyze.open();
  await staleTick;

  assert.deepEqual(
    byRole(lines.filter((line) => line.includes(runs.runIds[0])), { [runs.runIds[0]]: "stale", [agentId]: "agent" }),
    ["agent-scheduler: agent agent run stale superseded after it failed: analyze failed"],
  );
});

test("a run-now that lost its lease to a newer run commits nothing and returns its superseded run", docker, async (t) => {
  const { pool, agentId } = await plainAgent(t, "dev-api-agent-lease-run-now");
  const runs = signedRuns();
  const adapters = createServiceDevApiAdapters({ db: pool, createAgentLoopStages: runs.createAgentLoopStages } as never);

  const staleRun = adapters.agents.run({ userId: USER_ID, agentId });
  await runs.gates.analyze.reached;
  await expireLease(pool, runs.runIds[0]);
  const newer = await adapters.agents.run({ userId: USER_ID, agentId });
  runs.gates.analyze.open();
  const stale = await staleRun.catch((error: Error) => error.message);

  assert.deepEqual(byRole({
    stale: runView(stale),
    newer: runView(newer),
    watermarks: (await getAgent(pool, agentId))?.watermarks,
    effects: await effects(pool, agentId),
  }, { [runs.runIds[0]]: "stale", [runs.runIds[1]]: "newer" }), {
    stale: { id: "stale", status: "failed", error: "agent run claim expired" },
    newer: { id: "newer", status: "completed", error: null },
    watermarks: { last_run_id: "newer" },
    effects: ["effect of newer"],
  });
});

for (const [committer, expire] of [["a live run", false], ["a run whose lease had expired", true]] as const) {
  test(`a run-now that arrives mid-commit of ${committer} waits for that commit and leaves the run completed`, docker, async (t) => {
    const { pool, agentId } = await plainAgent(t, `dev-api-agent-lease-commit-${expire ? "expired" : "live"}`);
    const runs = signedRuns(["analyze", "applySideEffects"]);
    const adapters = createServiceDevApiAdapters({ db: pool, createAgentLoopStages: runs.createAgentLoopStages } as never);

    const committingRun = adapters.agents.run({ userId: USER_ID, agentId });
    await runs.gates.analyze.reached;
    if (expire) await expireLease(pool, runs.runIds[0]);
    runs.gates.analyze.open();
    await runs.gates.applySideEffects.reached;
    const otherRun = adapters.agents.run({ userId: USER_ID, agentId });
    const otherLandedFirst = await landsWithoutWaiting(pool, otherRun);
    runs.gates.applySideEffects.open();
    const [committing, other] = await Promise.all([committingRun, otherRun]);
    const otherRanItsOwn = other?.agent_run_log_id !== runs.runIds[0];

    assert.deepEqual(byRole({
      otherLandedFirst,
      committing: runView(committing),
      watermarks: (await getAgent(pool, agentId))?.watermarks,
      effects: await effects(pool, agentId),
    }, { [runs.runIds[0]]: "committing", ...(runs.runIds[1] === undefined ? {} : { [runs.runIds[1]]: "other" }) }), {
      otherLandedFirst: false,
      committing: { id: "committing", status: "completed", error: null },
      watermarks: { last_run_id: otherRanItsOwn ? "other" : "committing" },
      effects: otherRanItsOwn ? ["effect of committing", "effect of other"] : ["effect of committing"],
    });
  });
}

test("a thesis run that lost its lease records no stale assessment while the newer run is in flight", docker, async (t) => {
  const { db, pool, agentId, fact } = await thesisAgent(t, "dev-api-agent-lease-thesis-in-flight");
  const gates = [gate(), gate()];
  const runs = heldThesisRuns(pool, gates);
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
    stale: { id: "stale", status: "failed", error: "agent run claim expired" },
    newer: { id: "newer", status: "completed", error: null },
    assessments: [{ run: "newer", status: "challenged" }],
    watermark: "newer",
  });
});

test("a scheduled thesis run that lost its lease leaves the newer assessment's watermark in place", docker, async (t) => {
  const { pool, agentId } = await thesisAgent(t, "dev-api-agent-lease-thesis-after");
  const gates = [gate()];
  const runs = heldThesisRuns(pool, gates);
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
