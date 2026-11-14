import assert from "node:assert/strict";
import test from "node:test";

import { createAgent } from "../../agents/src/agent-repo.ts";
import type { AgentLoopStages } from "../../agents/src/agent-loop.ts";
import type { UniverseResolverDeps } from "../../analyst-grids/src/universe.ts";
import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { startAgentScheduler } from "../src/agent-scheduler.ts";
import { agentUniverseSubjectRefs } from "../src/local-runtime.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const SCREEN_ID = "40000000-0000-4000-8000-000000000004";
const WATCHLIST_ID = "50000000-0000-4000-8000-000000000005";
const PORTFOLIO_ID = "60000000-0000-4000-8000-000000000006";
const ISSUER_A = { kind: "issuer" as const, id: "70000000-0000-4000-8000-000000000007" };
const ISSUER_B = { kind: "issuer" as const, id: "70000000-0000-4000-8000-000000000008" };
const ISSUER_C = { kind: "issuer" as const, id: "70000000-0000-4000-8000-000000000009" };

const noopStages: AgentLoopStages = {
  readDeltas: async () => ({}),
  extractEvidence: async () => ({}),
  clusterEvidence: async () => ({}),
  analyze: async () => ({}),
  nextWatermarks: async () => ({}),
  applySideEffects: async () => ({ findings: 0 }),
};

test("two schedulers that read one due run claim it once under one run id", { skip: !dockerAvailable(), timeout: 120_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "dev-api-agent-scheduler");
  const pool = await connectedPool(t, databaseUrl);
  await pool.query(`insert into users (user_id, email) values ($1::uuid, 'scheduler@example.com')`, [USER_ID]);
  const agent = await createAgent(pool, {
    user_id: USER_ID,
    name: "Hourly",
    thesis: "Watch margins.",
    cadence: "hourly",
    universe: { mode: "static", subject_refs: [] },
  });
  await pool.query(
    `insert into agent_run_logs (agent_id, started_at, ended_at, status, outputs_summary)
     values ($1::uuid, now() - interval '2 hours', now() - interval '2 hours', 'completed', '{}'::jsonb)`,
    [agent.agent_id],
  );

  const stageCalls: string[] = [];
  const createAgentLoopStages = ({ runId }: { runId: string }) => {
    stageCalls.push(runId);
    return noopStages;
  };
  let markRead!: () => void;
  let release!: () => void;
  const read = new Promise<void>((resolve) => { markRead = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  // The second scheduler reads the schedule, then waits until the first has run.
  const lateDb = {
    query: (async (text: string, values?: unknown[]) => {
      const result = await pool.query(text, values);
      if (text.includes("left join agent_run_logs")) {
        markRead();
        await gate;
      }
      return result;
    }) as typeof pool.query,
    connect: () => pool.connect(),
  };
  const first = startAgentScheduler({ db: pool, createAgentLoopStages, log: () => {} }, 3_600_000);
  const second = startAgentScheduler({ db: lateDb, createAgentLoopStages, log: () => {} }, 3_600_000);
  t.after(() => Promise.all([first.stop(), second.stop()]));

  const secondTick = second.tick();
  await read;
  const firstResults = await first.tick();
  release();
  const secondResults = await secondTick;

  assert.deepEqual(firstResults.map((r) => r.status), ["completed"]);
  assert.deepEqual(secondResults.map((r) => r.status), ["duplicate"]);
  assert.equal(secondResults[0].run_id, firstResults[0].run_id);
  assert.deepEqual(stageCalls, [firstResults[0].run_id]);
  const { rows } = await pool.query(
    `select agent_run_log_id::text as id, status from agent_run_logs where agent_id = $1::uuid and started_at > now() - interval '1 hour'`,
    [agent.agent_id],
  );
  assert.deepEqual(rows, [{ id: firstResults[0].run_id, status: "completed" }]);
});

test("screen, watchlist, and portfolio universes resolve to the companies they hold", async () => {
  const calls: string[] = [];
  const resolvers: UniverseResolverDeps = {
    resolveScreen: async (userId, id) => { calls.push(`screen ${userId} ${id}`); return [ISSUER_A, ISSUER_B]; },
    resolveWatchlist: async (userId, id) => { calls.push(`watchlist ${userId} ${id}`); return [ISSUER_B]; },
    resolvePortfolio: async (userId, id) => { calls.push(`portfolio ${userId} ${id}`); return [ISSUER_C]; },
    resolvePeers: async () => assert.fail("agent universes have no peers source"),
  };
  const db = { query: async () => assert.fail("only a mirror universe reads the database") };

  assert.deepEqual(await agentUniverseSubjectRefs(db, USER_ID, { mode: "screen", screen_id: SCREEN_ID }, resolvers), [ISSUER_A, ISSUER_B]);
  assert.deepEqual(await agentUniverseSubjectRefs(db, USER_ID, { mode: "watchlist", watchlist_id: WATCHLIST_ID }, resolvers), [ISSUER_B]);
  assert.deepEqual(await agentUniverseSubjectRefs(db, USER_ID, { mode: "portfolio", portfolio_id: PORTFOLIO_ID }, resolvers), [ISSUER_C]);
  assert.deepEqual(calls, [
    `screen ${USER_ID} ${SCREEN_ID}`,
    `watchlist ${USER_ID} ${WATCHLIST_ID}`,
    `portfolio ${USER_ID} ${PORTFOLIO_ID}`,
  ]);
});
