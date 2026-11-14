import { getAgent, type QueryExecutor } from "../../agents/src/agent-repo.ts";
import { AGENT_CADENCES } from "../../agents/src/cadence.ts";
import { runAgentLoop } from "../../agents/src/agent-loop.ts";
import { handleAgentRunMessage, type AgentRunMessageResult } from "../../agents/src/queue-runner.ts";
import { dueAgentRuns, scheduledAgentRuns, type SchedulableAgent } from "../../agents/src/scheduler.ts";
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

type ScheduleRow = {
  agent_id: string;
  cadence: string;
  enabled: boolean;
  created_at: Date;
  last_run_at: Date | null;
};

export function startAgentSchedulerFromEnv(
  deps: AgentSchedulerDeps,
  env: { AGENT_SCHEDULER_INTERVAL_MS?: string },
): AgentScheduler | null {
  const interval = Number(env.AGENT_SCHEDULER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (interval === 0) return null;
  return startAgentScheduler(deps, Number.isSafeInteger(interval) && interval >= 1_000 ? interval : DEFAULT_INTERVAL_MS);
}

// ponytail: due runs execute one after another inside a tick, so one slow run delays the rest; run them in parallel if agents outgrow one interval.
export function startAgentScheduler(deps: AgentSchedulerDeps, intervalMs: number): AgentScheduler {
  const log = deps.log ?? ((line: string) => console.log(line));
  const loggedDueAt = new Map<string, string>();
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<unknown> = Promise.resolve();

  async function tick(): Promise<AgentRunMessageResult[]> {
    const { rows } = await deps.db.query<ScheduleRow>(
      `select a.agent_id::text as agent_id, a.cadence, a.enabled, a.created_at, max(l.started_at) as last_run_at
         from agents a
         left join agent_run_logs l on l.agent_id = a.agent_id
        where a.cadence = any($1::text[])
        group by a.agent_id`,
      [AGENT_CADENCES],
    );
    const agents: SchedulableAgent[] = rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }));
    const lastRuns = new Map(rows.flatMap((row) => row.last_run_at ? [[row.agent_id, row.last_run_at.toISOString()] as const] : []));
    for (const run of scheduledAgentRuns(agents, lastRuns)) {
      if (loggedDueAt.get(run.agent_id) === run.due_at) continue;
      loggedDueAt.set(run.agent_id, run.due_at);
      log(`agent-scheduler: agent ${run.agent_id} next_due_at=${run.due_at}`);
    }
    const results: AgentRunMessageResult[] = [];
    for (const run of dueAgentRuns(agents, lastRuns, deps.now?.() ?? new Date())) {
      // One agent whose claim fails must not starve the agents due after it.
      try {
        const result = await handleAgentRunMessage(deps.db, {
          message: { run_id: run.run_id, agent_id: run.agent_id, enqueued_at: run.due_at },
          execute: () => executeScheduledRun(deps, run.agent_id, run.run_id),
        });
        log(`agent-scheduler: agent ${run.agent_id} run ${run.run_id} ${result.status}`);
        results.push(result);
      } catch (error) {
        log(`agent-scheduler: agent ${run.agent_id} run ${run.run_id} not started: ${errorMessage(error)}`);
      }
    }
    return results;
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
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
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
