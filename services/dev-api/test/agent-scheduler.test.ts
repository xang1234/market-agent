import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type { Pool } from "pg";

import { createAgent, type AgentUniverse } from "../../agents/src/agent-repo.ts";
import type { AgentLoopStages } from "../../agents/src/agent-loop.ts";
import type { UniverseResolverDeps } from "../../analyst-grids/src/universe.ts";
import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { startAgentScheduler, startAgentSchedulerFromEnv } from "../src/agent-scheduler.ts";
import { agentUniverseSubjectRefs } from "../src/local-runtime.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "10000000-0000-4000-8000-000000000002";
const SCREEN_ID = "40000000-0000-4000-8000-000000000004";
const WATCHLIST_ID = "50000000-0000-4000-8000-000000000005";
const PORTFOLIO_ID = "60000000-0000-4000-8000-000000000006";
const THEME_ID = "80000000-0000-4000-8000-000000000008";
const ISSUER_A = { kind: "issuer" as const, id: "70000000-0000-4000-8000-000000000007" };
const ISSUER_B = { kind: "issuer" as const, id: "70000000-0000-4000-8000-000000000008" };
const ISSUER_C = { kind: "issuer" as const, id: "70000000-0000-4000-8000-000000000009" };
const docker = { skip: !dockerAvailable(), timeout: 120_000 };

const noopStages: AgentLoopStages = {
  readDeltas: async () => ({}),
  extractEvidence: async () => ({}),
  clusterEvidence: async () => ({}),
  analyze: async () => ({}),
  nextWatermarks: async () => ({}),
  applySideEffects: async () => ({ findings: 0 }),
};

const resolvers: UniverseResolverDeps = {
  resolveScreen: async (userId, id) => (userId === USER_ID && id === SCREEN_ID ? [ISSUER_A, ISSUER_B] : []),
  resolveWatchlist: async (userId, id) => (userId === USER_ID && id === WATCHLIST_ID ? [ISSUER_B] : []),
  resolvePortfolio: async (userId, id) => (userId === USER_ID && id === PORTFOLIO_ID ? [ISSUER_C] : []),
  resolvePeers: async () => assert.fail("agent universes have no peers source"),
};

async function seededPool(t: TestContext, prefix: string): Promise<Pool> {
  const { databaseUrl } = await bootstrapDatabase(t, prefix);
  const pool = await connectedPool(t, databaseUrl);
  await pool.query(
    `insert into users (user_id, email) values ($1::uuid, 'a@example.com'), ($2::uuid, 'b@example.com')`,
    [USER_ID, OTHER_USER_ID],
  );
  return pool;
}

async function hourlyAgentLastRunTwoHoursAgo(pool: Pool, name: string): Promise<string> {
  const agent = await createAgent(pool, {
    user_id: USER_ID,
    name,
    thesis: "Watch margins.",
    cadence: "hourly",
    universe: { mode: "static", subject_refs: [] },
  });
  await pool.query(
    `insert into agent_run_logs (agent_id, started_at, ended_at, status, outputs_summary)
     values ($1::uuid, now() - interval '2 hours', now() - interval '2 hours', 'completed', '{}'::jsonb)`,
    [agent.agent_id],
  );
  return agent.agent_id;
}

// A pool whose first query matching `pauseAfter` holds its result until resume().
function pausingPool(pool: Pool, pauseAfter: (values: unknown[]) => boolean) {
  let reached!: () => void;
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { reached = resolve; });
  const resumed = new Promise<void>((resolve) => { resume = resolve; });
  let held = false;
  const db = {
    query: (async (text: string, values?: unknown[]) => {
      const result = await pool.query(text, values);
      if (!held && text.includes("left join lateral") && pauseAfter(values ?? [])) {
        held = true;
        reached();
        await resumed;
      }
      return result;
    }) as Pool["query"],
    connect: () => pool.connect(),
  };
  return { db, paused, resume };
}

function recordingStages() {
  const runIds: string[] = [];
  return {
    runIds,
    createAgentLoopStages: ({ runId }: { runId: string }) => {
      runIds.push(runId);
      return noopStages;
    },
  };
}

test("two schedulers that both pass the claim-time check claim one run id once", docker, async (t) => {
  const pool = await seededPool(t, "dev-api-agent-scheduler-dedupe");
  const agentId = await hourlyAgentLastRunTwoHoursAgo(pool, "Hourly");
  const stages = recordingStages();
  const late = pausingPool(pool, (values) => values[1] === agentId);
  const first = startAgentScheduler({ db: pool, ...stages, log: () => {} }, 3_600_000);
  const second = startAgentScheduler({ db: late.db, ...stages, log: () => {} }, 3_600_000);
  t.after(() => Promise.all([first.stop(), second.stop()]));

  const secondTick = second.tick();
  await late.paused;
  const firstResults = await first.tick();
  late.resume();
  const secondResults = await secondTick;

  assert.deepEqual(firstResults.map((r) => r.status), ["completed"]);
  assert.deepEqual(secondResults.map((r) => r.status), ["duplicate"]);
  assert.equal(secondResults[0].run_id, firstResults[0].run_id);
  assert.deepEqual(stages.runIds, [firstResults[0].run_id]);
  const { rows } = await pool.query(
    `select agent_run_log_id::text as id, status from agent_run_logs where agent_id = $1::uuid and started_at > now() - interval '1 hour'`,
    [agentId],
  );
  assert.deepEqual(rows, [{ id: firstResults[0].run_id, status: "completed" }]);
});

for (const [change, sql] of [
  ["a manual run completes", `insert into agent_run_logs (agent_id, status, ended_at, outputs_summary) values ($1::uuid, 'completed', now(), '{"trigger":"manual"}'::jsonb)`],
  ["the agent is disabled", `update agents set enabled = false where agent_id = $1::uuid`],
] as const) {
  test(`a due run is skipped when ${change} between the schedule read and the claim`, docker, async (t) => {
    const pool = await seededPool(t, "dev-api-agent-scheduler-stale");
    const agentId = await hourlyAgentLastRunTwoHoursAgo(pool, "Hourly");
    const stages = recordingStages();
    const lines: string[] = [];
    const late = pausingPool(pool, (values) => values[1] === null);
    const scheduler = startAgentScheduler({ db: late.db, ...stages, log: (line) => lines.push(line) }, 3_600_000);
    t.after(() => scheduler.stop());

    const tick = scheduler.tick();
    await late.paused;
    await pool.query(sql, [agentId]);
    late.resume();

    assert.deepEqual(await tick, []);
    assert.deepEqual(stages.runIds, []);
    assert.equal(lines.filter((line) => line.endsWith("skipped: no longer due")).length, 1);
  });
}

test("stop ends a tick before its next due agent", docker, async (t) => {
  const pool = await seededPool(t, "dev-api-agent-scheduler-stop");
  await hourlyAgentLastRunTwoHoursAgo(pool, "First");
  await hourlyAgentLastRunTwoHoursAgo(pool, "Second");
  const runIds: string[] = [];
  const scheduler = startAgentScheduler({
    db: pool,
    log: () => {},
    createAgentLoopStages: async ({ runId }) => {
      runIds.push(runId);
      await scheduler.stop();
      return noopStages;
    },
  }, 3_600_000);

  assert.deepEqual((await scheduler.tick()).map((r) => r.status), ["completed"]);
  assert.equal(runIds.length, 1);
});

test("stop during the claim-time check starts no run", docker, async (t) => {
  const pool = await seededPool(t, "dev-api-agent-scheduler-stop-recheck");
  const agentId = await hourlyAgentLastRunTwoHoursAgo(pool, "Hourly");
  const stages = recordingStages();
  const late = pausingPool(pool, (values) => values[1] === agentId);
  const scheduler = startAgentScheduler({ db: late.db, ...stages, log: () => {} }, 3_600_000);

  const tick = scheduler.tick();
  await late.paused;
  await scheduler.stop();
  late.resume();

  assert.deepEqual(await tick, []);
  assert.deepEqual(stages.runIds, []);
});

test("AGENT_SCHEDULER_INTERVAL_MS turns the scheduler off at 0 and warns once for an invalid value", async () => {
  const lines: string[] = [];
  const deps = { db: {}, createAgentLoopStages: () => noopStages, log: (line: string) => lines.push(line) } as never;
  assert.equal(startAgentSchedulerFromEnv(deps, { AGENT_SCHEDULER_INTERVAL_MS: "0" }), null);
  assert.equal(startAgentSchedulerFromEnv(deps, { AGENT_SCHEDULER_INTERVAL_MS: "00" }), null);
  for (const value of ["", " ", "10000", "abc", undefined]) {
    const scheduler = startAgentSchedulerFromEnv(deps, { AGENT_SCHEDULER_INTERVAL_MS: value });
    assert.notEqual(scheduler, null, `interval ${JSON.stringify(value)}`);
    await scheduler?.stop();
  }
  assert.deepEqual(lines, [
    "agent-scheduler: AGENT_SCHEDULER_INTERVAL_MS=abc is not 0 or an integer of at least 1000, so it ticks every 60000 ms",
  ]);
});

test("screen, watchlist, portfolio, static, and theme universes resolve to their subject refs", async () => {
  const db = { query: async () => assert.fail("only a mirror universe reads the database") };
  const cases: Array<[AgentUniverse, unknown]> = [
    [{ mode: "screen", screen_id: SCREEN_ID }, [ISSUER_A, ISSUER_B]],
    [{ mode: "watchlist", watchlist_id: WATCHLIST_ID }, [ISSUER_B]],
    [{ mode: "portfolio", portfolio_id: PORTFOLIO_ID }, [ISSUER_C]],
    [{ mode: "static", subject_refs: [ISSUER_A] }, [ISSUER_A]],
    [{ mode: "theme", theme_id: THEME_ID }, [{ kind: "theme", id: THEME_ID }]],
  ];
  for (const [universe, expected] of cases) {
    assert.deepEqual(await agentUniverseSubjectRefs(db, USER_ID, universe, resolvers), expected, universe.mode);
  }
});

test("a mirror universe borrows one of the user's own agents, never a mirror or another user's agent", docker, async (t) => {
  const pool = await seededPool(t, "dev-api-agent-mirror-universe");
  const agent = (user_id: string, universe: AgentUniverse) =>
    createAgent(pool, { user_id, name: "Source", thesis: "Watch margins.", cadence: "daily", universe });
  const screenAgent = await agent(USER_ID, { mode: "screen", screen_id: SCREEN_ID });
  const mirrorAgent = await agent(USER_ID, { mode: "agent", agent_id: screenAgent.agent_id });
  const otherUsersAgent = await agent(OTHER_USER_ID, { mode: "screen", screen_id: SCREEN_ID });

  const resolve = (agent_id: string) => agentUniverseSubjectRefs(pool, USER_ID, { mode: "agent", agent_id }, resolvers);
  assert.deepEqual(await resolve(screenAgent.agent_id), [ISSUER_A, ISSUER_B]);
  assert.deepEqual(await resolve(mirrorAgent.agent_id), []);
  assert.deepEqual(await resolve(otherUsersAgent.agent_id), []);
});
