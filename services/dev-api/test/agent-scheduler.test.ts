import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type { Pool, QueryResult } from "pg";

import { createAgent, type AgentUniverse } from "../../agents/src/agent-repo.ts";
import type { AgentLoopStages } from "../../agents/src/agent-loop.ts";
import type { UniverseResolverDeps } from "../../analyst-grids/src/universe.ts";
import { bootstrapDatabase, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { startAgentScheduler, startAgentSchedulerFromEnv } from "../src/agent-scheduler.ts";
import { createServiceDevApiAdapters } from "../src/http.ts";
import { AgentUniverseUnavailableError, agentUniverseResolvers, agentUniverseSubjectRefs } from "../src/local-runtime.ts";
import { DynamicWatchlistNotFoundError } from "../../watchlists/src/dynamic-membership.ts";

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

// A pool whose first schedule read matching `pauseAfter`, on the pool or on a
// client it lends, holds its result until resume().
function pausingPool(pool: Pool, pauseAfter: (values: unknown[]) => boolean) {
  let reached!: () => void;
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { reached = resolve; });
  const resumed = new Promise<void>((resolve) => { resume = resolve; });
  let held = false;
  const pausing = (run: (text: string, values?: unknown[]) => Promise<QueryResult>) =>
    (async (text: string, values?: unknown[]) => {
      const result = await run(text, values);
      if (!held && text.includes("left join lateral") && pauseAfter(values ?? [])) {
        held = true;
        reached();
        await resumed;
      }
      return result;
    }) as Pool["query"];
  const db = {
    query: pausing((text, values) => pool.query(text, values)),
    connect: async () => {
      const client = await pool.connect();
      return { query: pausing((text, values) => client.query(text, values)), release: (error?: Error) => client.release(error) };
    },
  };
  return { db, paused, resume };
}

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

test("two schedulers that read one due run claim its run id once", docker, async (t) => {
  const pool = await seededPool(t, "dev-api-agent-scheduler-dedupe");
  const agentId = await hourlyAgentLastRunTwoHoursAgo(pool, "Hourly");
  const stages = recordingStages();
  const late = pausingPool(pool, (values) => values[1] === null);
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

test("a disable that commits during the claim-time check waits for the claim", docker, async (t) => {
  const pool = await seededPool(t, "dev-api-agent-scheduler-disable-race");
  const agentId = await hourlyAgentLastRunTwoHoursAgo(pool, "Hourly");
  const stages = recordingStages();
  const late = pausingPool(pool, (values) => values[1] === agentId);
  const scheduler = startAgentScheduler({ db: late.db, ...stages, log: () => {} }, 3_600_000);
  t.after(() => scheduler.stop());

  const tick = scheduler.tick();
  await late.paused;
  const disable = pool.query(`update agents set enabled = false where agent_id = $1::uuid`, [agentId]);
  const landedFirst = await landsWithoutWaiting(pool, disable);
  late.resume();
  await disable;

  assert.deepEqual({ landedFirst, scheduled: (await tick).map((r) => r.status) }, { landedFirst: false, scheduled: ["completed"] });
  assert.equal(stages.runIds.length, 1);
});

test("a run-now during the claim-time check waits for the scheduled claim", docker, async (t) => {
  const pool = await seededPool(t, "dev-api-agent-scheduler-manual-race");
  const agentId = await hourlyAgentLastRunTwoHoursAgo(pool, "Hourly");
  const stages = recordingStages();
  const late = pausingPool(pool, (values) => values[1] === agentId);
  const scheduler = startAgentScheduler({ db: late.db, ...stages, log: () => {} }, 3_600_000);
  t.after(() => scheduler.stop());
  const adapters = createServiceDevApiAdapters({ db: pool, createAgentLoopStages: () => noopStages } as never);

  const tick = scheduler.tick();
  await late.paused;
  const manual = adapters.agents.run({ userId: USER_ID, agentId });
  const landedFirst = await landsWithoutWaiting(pool, manual);
  late.resume();
  const scheduled = await tick;
  await manual;

  assert.deepEqual({ landedFirst, scheduled: scheduled.map((r) => r.status) }, { landedFirst: false, scheduled: ["completed"] });
  const { rows } = await pool.query<{ id: string }>(
    `select agent_run_log_id::text as id from agent_run_logs where agent_id = $1::uuid and started_at > now() - interval '1 hour' order by started_at limit 1`,
    [agentId],
  );
  assert.deepEqual(rows, [{ id: scheduled[0].run_id }]);
});

test("a run-now for another user's agent claims nothing", docker, async (t) => {
  const pool = await seededPool(t, "dev-api-agent-run-now-owner");
  const agentId = await hourlyAgentLastRunTwoHoursAgo(pool, "Hourly");
  const adapters = createServiceDevApiAdapters({ db: pool, createAgentLoopStages: () => noopStages } as never);

  assert.equal(await adapters.agents.run({ userId: OTHER_USER_ID, agentId }), null);
  const { rows } = await pool.query(`select 1 from agent_run_logs where agent_id = $1::uuid and started_at > now() - interval '1 hour'`, [agentId]);
  assert.deepEqual(rows, []);
});

test("a failed scheduled run records its trigger", docker, async (t) => {
  const pool = await seededPool(t, "dev-api-agent-scheduler-failed");
  const agentId = await hourlyAgentLastRunTwoHoursAgo(pool, "Hourly");
  const scheduler = startAgentScheduler({
    db: pool,
    log: () => {},
    createAgentLoopStages: async () => { throw new Error("stages unavailable"); },
  }, 3_600_000);
  t.after(() => scheduler.stop());

  assert.deepEqual((await scheduler.tick()).map((r) => r.status), ["failed"]);
  const { rows } = await pool.query(
    `select status, error, outputs_summary from agent_run_logs where agent_id = $1::uuid and started_at > now() - interval '1 hour'`,
    [agentId],
  );
  assert.deepEqual(rows, [{ status: "failed", error: "stages unavailable", outputs_summary: { trigger: "scheduled", status: "failed" } }]);
});

test("stop returns at its 10 s bound while a timer-driven tick hangs", { timeout: 5_000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  const db = { query: () => { reads += 1; return new Promise(() => {}); }, connect: () => assert.fail("a hung read claims nothing") };
  const scheduler = startAgentScheduler({ db, createAgentLoopStages: () => noopStages, log: () => {} } as never, 1_000);
  t.mock.timers.tick(1_000);
  assert.equal(reads, 1, "the interval timer started a tick");

  let returned = false;
  const stopping = scheduler.stop().then(() => { returned = true; });
  t.mock.timers.tick(9_999);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(returned, false, "stop waits for the tick until the bound");
  t.mock.timers.tick(1);
  await stopping;
  assert.equal(returned, true);
});

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

test("a screen universe refuses a candidate source the screener would refuse", async () => {
  const db = { query: async () => assert.fail("the source is checked before any read") };
  await assert.rejects(
    agentUniverseSubjectRefs(db, USER_ID, { mode: "screen", screen_id: SCREEN_ID }, agentUniverseResolvers(db, { SCREENER_CANDIDATE_SOURCE: "vendr" })),
    { name: "AgentUniverseUnavailableError", message: "SCREENER_CANDIDATE_SOURCE must be 'reported' or 'vendor' (got 'vendr')" },
  );
});

const VENDOR_LISTING_ID = "22222222-2222-4222-8222-222222222222";

// Only the vendor candidate read returns a row, so a reported replay finds nothing.
function screenerDb() {
  const definition = {
    universe: [{ field: "asset_type", values: ["common_stock"] }],
    market: [],
    fundamentals: [],
    sort: [{ field: "market_cap", direction: "desc" }],
    page: { limit: 50 },
  };
  const rows = (text: string): unknown[] => {
    if (text.includes("from watchlists")) {
      return [{ watchlist_id: WATCHLIST_ID, user_id: USER_ID, mode: "screen", membership_spec: { screen_id: SCREEN_ID } }];
    }
    if (text.includes("from screener_screens")) {
      return [{ screen_id: SCREEN_ID, user_id: USER_ID, name: "Commons", definition, created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z" }];
    }
    if (!text.includes("issuer_profile_enrichments")) return [];
    return [{
      listing_id: VENDOR_LISTING_ID, legal_name: "Vendor Co", share_class: null, asset_type: "common_stock", mic: "XNAS", ticker: "VEND",
      trading_currency: "USD", domicile: "US", sector: "Technology", industry: "Software", price: 10, prev_close: 9, delay_class: "delayed_15m",
      currency: "USD", as_of: "2026-11-01T00:00:00.000Z", market_cap: null, pe_ratio: null, gross_margin: null, operating_margin: null,
      net_margin: null, revenue_growth_yoy: null, forward_pe: null, roic: null, perf_quarter: null, perf_year: null, rsi_14: null,
      week_52_high_distance: null,
    }];
  };
  return { query: async (text: string) => ({ rows: rows(text), rowCount: null }) } as never;
}

test("a screen universe and a screen-mode watchlist replay over the vendor candidates when the screener reads vendor", async () => {
  const vendorRefs = [{ kind: "listing", id: VENDOR_LISTING_ID }];
  for (const [source, expected] of [["vendor", vendorRefs], ["reported", []]] as const) {
    const db = screenerDb();
    const resolvers = agentUniverseResolvers(db, { SCREENER_CANDIDATE_SOURCE: source });
    assert.deepEqual(await agentUniverseSubjectRefs(db, USER_ID, { mode: "screen", screen_id: SCREEN_ID }, resolvers), expected, `${source} screen`);
    assert.deepEqual(await agentUniverseSubjectRefs(db, USER_ID, { mode: "watchlist", watchlist_id: WATCHLIST_ID }, resolvers), expected, `${source} watchlist`);
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
  await assert.rejects(resolve(mirrorAgent.agent_id), AgentUniverseUnavailableError);
  await assert.rejects(resolve(otherUsersAgent.agent_id), AgentUniverseUnavailableError);
  await assert.rejects(resolve(THEME_ID), AgentUniverseUnavailableError);
});

test("a watchlist universe resolves the watchlist's mode, not only its stored members", docker, async (t) => {
  const pool = await seededPool(t, "dev-api-agent-watchlist-universe");
  const watchlist = async (user_id: string, mode: string, membership_spec: object | null) =>
    (await pool.query<{ watchlist_id: string }>(
      `insert into watchlists (user_id, name, mode, membership_spec) values ($1::uuid, $2, $3::watchlist_mode, $4::jsonb) returning watchlist_id`,
      [user_id, mode, mode, membership_spec === null ? null : JSON.stringify(membership_spec)],
    )).rows[0].watchlist_id;
  const manual = await watchlist(USER_ID, "manual", null);
  await pool.query(`insert into watchlist_members (watchlist_id, subject_kind, subject_id) values ($1::uuid, 'issuer', $2::uuid)`, [manual, ISSUER_A.id]);
  const { rows: [{ portfolio_id }] } = await pool.query<{ portfolio_id: string }>(
    `insert into portfolios (user_id, name, base_currency) values ($1::uuid, 'Book', 'USD') returning portfolio_id`,
    [USER_ID],
  );
  await pool.query(`insert into portfolio_holdings (portfolio_id, subject_kind, subject_id, quantity) values ($1::uuid, 'issuer', $2::uuid, 10)`, [portfolio_id, ISSUER_C.id]);
  const agent = (universe: AgentUniverse) =>
    createAgent(pool, { user_id: USER_ID, name: "Source", thesis: "Watch margins.", cadence: "daily", universe });
  const staticAgent = await agent({ mode: "static", subject_refs: [ISSUER_B] });
  const watchlistAgent = await agent({ mode: "watchlist", watchlist_id: manual });

  const resolve = (watchlist_id: string) => agentUniverseSubjectRefs(pool, USER_ID, { mode: "watchlist", watchlist_id });
  assert.deepEqual(await resolve(manual), [ISSUER_A]);
  assert.deepEqual(await resolve(await watchlist(USER_ID, "portfolio", { portfolio_id })), [ISSUER_C]);
  assert.deepEqual(await resolve(await watchlist(USER_ID, "agent", { agent_id: staticAgent.agent_id })), [ISSUER_B]);
  await assert.rejects(resolve(await watchlist(USER_ID, "agent", { agent_id: watchlistAgent.agent_id })), AgentUniverseUnavailableError);
  await assert.rejects(resolve(await watchlist(OTHER_USER_ID, "manual", null)), DynamicWatchlistNotFoundError);
});

test("a watchlist universe backed by a theme, directly or through a theme agent, reads the theme's current members", docker, async (t) => {
  const pool = await seededPool(t, "dev-api-agent-theme-watchlist-universe");
  const { rows: [{ theme_id }] } = await pool.query<{ theme_id: string }>(
    `insert into themes (name, membership_mode) values ('AI capex', 'manual') returning theme_id`,
  );
  await pool.query(
    `insert into theme_memberships (theme_id, subject_kind, subject_id, effective_at, expires_at)
     values ($1::uuid, 'issuer', $2::uuid, now() - interval '1 day', null),
            ($1::uuid, 'issuer', $3::uuid, now() - interval '2 days', now() - interval '1 day')`,
    [theme_id, ISSUER_A.id, ISSUER_B.id],
  );
  const themeAgent = await createAgent(pool, {
    user_id: USER_ID, name: "Theme", thesis: "Watch margins.", cadence: "daily", universe: { mode: "theme", theme_id },
  });
  const watchlist = async (mode: string, membership_spec: object) =>
    (await pool.query<{ watchlist_id: string }>(
      `insert into watchlists (user_id, name, mode, membership_spec) values ($1::uuid, $2, $3::watchlist_mode, $4::jsonb) returning watchlist_id`,
      [USER_ID, mode, mode, JSON.stringify(membership_spec)],
    )).rows[0].watchlist_id;

  const resolve = (watchlist_id: string) => agentUniverseSubjectRefs(pool, USER_ID, { mode: "watchlist", watchlist_id });
  assert.deepEqual(await resolve(await watchlist("theme", { theme_id })), [ISSUER_A]);
  assert.deepEqual(await resolve(await watchlist("agent", { agent_id: themeAgent.agent_id })), [ISSUER_A]);
});
