import { getAgent, type QueryExecutor } from "../../agents/src/agent-repo.ts";
import { AGENT_CADENCES } from "../../agents/src/cadence.ts";
import { runAgentLoop } from "../../agents/src/agent-loop.ts";
import { handleAgentRunMessage, type AgentRunMessageResult } from "../../agents/src/queue-runner.ts";
import { dueAgentRuns, scheduledAgentRuns, type SchedulableAgent, type ScheduledAgentRun } from "../../agents/src/scheduler.ts";
import type { AgentWatermarkClientPool } from "../../agents/src/watermarks.ts";
import type { DevApiAgentLoopStageFactory } from "./http.ts";

export type AgentSchedulerDeps = {
  db: QueryExecutor & AgentWatermarkClientPool;
  createAgentLoopStages: DevApiAgentLoopStageFactory;
  now?: () => Date;
  log?: (line: string) => void;
};

export type AgentScheduler = {
  tick(): Promise<AgentRunMessageResult[]>;
  stop(): Promise<void>;
};

const DEFAULT_INTERVAL_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;

type ScheduleRow = {
  agent_id: string;
  cadence: string;
  enabled: boolean;
  created_at: Date;
  last_run_at: Date | null;
};

type Schedule = { agents: SchedulableAgent[]; lastRuns: Map<string, string> };

export function startAgentSchedulerFromEnv(
  deps: AgentSchedulerDeps,
  env: { AGENT_SCHEDULER_INTERVAL_MS?: string },
): AgentScheduler | null {
  const raw = env.AGENT_SCHEDULER_INTERVAL_MS?.trim() || String(DEFAULT_INTERVAL_MS);
  const interval = Number(raw);
  if (interval === 0) return null;
  if (Number.isSafeInteger(interval) && interval >= 1_000) return startAgentScheduler(deps, interval);
  (deps.log ?? console.warn)(`agent-scheduler: AGENT_SCHEDULER_INTERVAL_MS=${raw} is not 0 or an integer of at least 1000, so it ticks every ${DEFAULT_INTERVAL_MS} ms`);
  return startAgentScheduler(deps, DEFAULT_INTERVAL_MS);
}

// ponytail: due runs execute one after another inside a tick, so one slow run delays the rest; run them in parallel if agents outgrow one interval.
export function startAgentScheduler(deps: AgentSchedulerDeps, intervalMs: number): AgentScheduler {
  const log = deps.log ?? ((line: string) => console.log(line));
  const now = () => deps.now?.() ?? new Date();
  const loggedDueAt = new Map<string, string>();
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<unknown> = Promise.resolve();

  async function tick(): Promise<AgentRunMessageResult[]> {
    const { agents, lastRuns } = await readSchedule(deps.db, null);
    for (const run of scheduledAgentRuns(agents, lastRuns)) {
      if (loggedDueAt.get(run.agent_id) === run.due_at) continue;
      loggedDueAt.set(run.agent_id, run.due_at);
      log(`agent-scheduler: agent ${run.agent_id} next_due_at=${run.due_at}`);
    }
    const results: AgentRunMessageResult[] = [];
    for (const run of dueAgentRuns(agents, lastRuns, now())) {
      if (stopped) break;
      const result = await claimAndRunIsolated(run);
      if (result) results.push(result);
    }
    return results;
  }

  async function claimAndRunIsolated(run: ScheduledAgentRun): Promise<AgentRunMessageResult | null> {
    try {
      const fresh = await readSchedule(deps.db, run.agent_id);
      if (stopped) return null;
      if (dueAgentRuns(fresh.agents, fresh.lastRuns, now())[0]?.run_id !== run.run_id) {
        log(`agent-scheduler: agent ${run.agent_id} run ${run.run_id} skipped: no longer due`);
        return null;
      }
      const result = await handleAgentRunMessage(deps.db, {
        message: { run_id: run.run_id, agent_id: run.agent_id, enqueued_at: run.due_at },
        execute: () => executeScheduledRun(deps, run.agent_id, run.run_id),
      });
      log(`agent-scheduler: agent ${run.agent_id} run ${run.run_id} ${result.status}`);
      return result;
    } catch (error) {
      log(`agent-scheduler: agent ${run.agent_id} run ${run.run_id} errored: ${errorMessage(error)}`);
      return null;
    }
  }

  function schedule(): void {
    timer = setTimeout(() => {
      inFlight = tick()
        .catch((error: unknown) => log(`agent-scheduler: tick failed: ${errorMessage(error)}`))
        .finally(() => { if (!stopped) schedule(); });
    }, intervalMs);
    timer.unref();
  }
  schedule();

  return {
    tick,
    // An abandoned run keeps its claim until the lease expires, and the next claim fails it.
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await Promise.race([inFlight, new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS).unref())]);
    },
  };
}

async function readSchedule(db: QueryExecutor, agentId: string | null): Promise<Schedule> {
  const { rows } = await db.query<ScheduleRow>(
    `select a.agent_id::text as agent_id, a.cadence, a.enabled, a.created_at, last_run.started_at as last_run_at
       from agents a
       left join lateral (
         select started_at from agent_run_logs l where l.agent_id = a.agent_id order by started_at desc limit 1
       ) last_run on true
      where a.enabled
        and a.cadence = any($1::text[])
        and ($2::uuid is null or a.agent_id = $2::uuid)`,
    [AGENT_CADENCES, agentId],
  );
  return {
    agents: rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() })),
    lastRuns: new Map(rows.flatMap((row) => row.last_run_at ? [[row.agent_id, row.last_run_at.toISOString()] as const] : [])),
  };
}

async function executeScheduledRun(deps: AgentSchedulerDeps, agentId: string, runId: string) {
  const agent = await getAgent(deps.db, agentId);
  if (agent === null) throw new Error("agent not found after run claim");
  const result = await runAgentLoop({
    pool: deps.db,
    agent_id: agentId,
    run_id: runId,
    current_watermarks: agent.watermarks,
    alert_rules: Array.isArray(agent.alert_rules) ? agent.alert_rules : [],
    stages: await deps.createAgentLoopStages({ userId: agent.user_id, runId, agent, trigger: "scheduled" }),
  });
  const summary = result.outputs_summary;
  return {
    trigger: "scheduled",
    status: "completed",
    ...(summary !== null && typeof summary === "object" && !Array.isArray(summary) ? summary : {}),
    next_watermarks: result.next_watermarks,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
