// Pure run-history stats for the Agents roster's monitor-first visuals (status
// dot, run-tick timeline, fleet summary). Kept as a tested module so the
// sorting/latest/tally logic isn't re-derived inside JSX. Input is structural —
// only the run fields the stats need.
export type RunStatus = 'running' | 'completed' | 'failed'

type RunLike = { agent_id: string; status: RunStatus; started_at: string }

// Chronological run statuses for one agent (oldest → newest), capped to the
// last `limit` runs — the data behind the roster's run-tick timeline.
export function agentRunTicks(
  runs: ReadonlyArray<RunLike>,
  agentId: string,
  limit = 12,
): RunStatus[] {
  const mine = runs
    .filter((r) => r.agent_id === agentId)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
  return mine.slice(Math.max(0, mine.length - limit)).map((r) => r.status)
}

// The most recent run's status for an agent (newest by started_at), or null
// when it has never run — drives the roster status dot.
export function latestRunStatus(runs: ReadonlyArray<RunLike>, agentId: string): RunStatus | null {
  let latest: RunLike | null = null
  for (const run of runs) {
    if (run.agent_id !== agentId) continue
    if (latest === null || run.started_at.localeCompare(latest.started_at) > 0) latest = run
  }
  return latest?.status ?? null
}

// Fleet health for the roster header: how many monitors, how many enabled, and
// how many are currently running or last failed (by latest run).
export function rosterRunSummary(
  agents: ReadonlyArray<{ agent_id: string; enabled: boolean }>,
  runs: ReadonlyArray<RunLike>,
): { total: number; enabled: number; running: number; failing: number } {
  let enabled = 0
  let running = 0
  let failing = 0
  for (const agent of agents) {
    // Disabled monitors are off the fleet — their last run's status doesn't
    // count toward running/failing health.
    if (!agent.enabled) continue
    enabled += 1
    const status = latestRunStatus(runs, agent.agent_id)
    if (status === 'running') running += 1
    else if (status === 'failed') failing += 1
  }
  return { total: agents.length, enabled, running, failing }
}
