import { createHash } from "node:crypto";
import { compileAgentCadence, nextDueAt } from "./cadence.ts";
import type { AgentRow } from "./agent-repo.ts";

export type SchedulableAgent = Pick<AgentRow, "agent_id" | "cadence" | "enabled" | "created_at">;

export type ScheduledAgentRun = {
  agent_id: string;
  run_id: string;
  due_at: string;
};

export function scheduledAgentRuns(
  agents: ReadonlyArray<SchedulableAgent>,
  lastRuns: ReadonlyMap<string, string>,
): ScheduledAgentRun[] {
  const runs: ScheduledAgentRun[] = [];
  for (const agent of agents) {
    if (!agent.enabled) continue;
    const dueAt = nextDueAt(compileAgentCadence(agent.cadence), lastRuns.get(agent.agent_id) ?? agent.created_at);
    if (dueAt === null) continue;
    runs.push({ agent_id: agent.agent_id, run_id: deterministicRunId(agent.agent_id, dueAt), due_at: dueAt });
  }
  return runs;
}

export function dueAgentRuns(
  agents: ReadonlyArray<SchedulableAgent>,
  lastRuns: ReadonlyMap<string, string>,
  now: Date,
): ScheduledAgentRun[] {
  return scheduledAgentRuns(agents, lastRuns).filter((run) => Date.parse(run.due_at) <= now.getTime());
}

function deterministicRunId(agentId: string, dueAt: string): string {
  const hex = createHash("sha1").update(`agent-run:${agentId}:${dueAt}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
