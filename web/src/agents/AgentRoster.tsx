import type { AgentRow, AgentRunRow } from './agentRows.ts'
import { agentRunTicks, latestRunStatus, rosterRunSummary, type RunStatus } from './runStats.ts'
import { alertRuleLabel, universeLabel } from './agentLabels.ts'

type AgentRosterProps = {
  agents: ReadonlyArray<AgentRow>
  runs: ReadonlyArray<AgentRunRow>
  selectedAgentId: string | null
  loadError: string | null
  onSelect: (agentId: string) => void
  onEdit: (agent: AgentRow) => void
  onRun: (agentId: string) => void
  onToggleEnabled: (agent: AgentRow) => void
  onDelete: (agentId: string) => void
}

const ROSTER_ACTION_CLASS = 'rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium'

// The monitor-first hero: agent roster with a status dot + run-tick timeline +
// fleet summary, plus the per-agent CRUD controls. Extracted from AgentsPage so
// the page holds orchestration, not presentation.
export function AgentRoster({
  agents,
  runs,
  selectedAgentId,
  loadError,
  onSelect,
  onEdit,
  onRun,
  onToggleEnabled,
  onDelete,
}: AgentRosterProps) {
  return (
    <section className="rounded-md border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold text-fg">Agents</h2>
      <FleetSummary fleet={rosterRunSummary(agents, runs)} />
      {loadError ? <p className="mt-3 text-sm text-negative">Load failed: {loadError}</p> : null}
      <ul className="mt-4 flex flex-col gap-3">
        {agents.map((agent) => (
          <li
            key={agent.agent_id}
            className={`rounded-md border p-3 ${
              selectedAgentId === agent.agent_id ? 'border-accent' : 'border-line'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                  <StatusDot status={latestRunStatus(runs, agent.agent_id)} />
                  {agent.name}
                </h3>
                <p className="mt-1 text-sm text-fg-soft">{agent.thesis}</p>
                <p className="mt-2 text-xs text-muted">
                  {agent.enabled ? 'enabled' : 'disabled'} · {agent.cadence}
                </p>
                <p className="mt-2 text-xs text-muted">Universe: {universeLabel(agent.universe)}</p>
                <p className="mt-1 text-xs text-muted">Alert rule: {alertRuleLabel(agent.alert_rules)}</p>
                <RunTimeline ticks={agentRunTicks(runs, agent.agent_id)} />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => onSelect(agent.agent_id)} className={ROSTER_ACTION_CLASS}>
                  View
                </button>
                <button type="button" onClick={() => onEdit(agent)} className={ROSTER_ACTION_CLASS}>
                  Edit
                </button>
                <button type="button" onClick={() => onRun(agent.agent_id)} className={ROSTER_ACTION_CLASS}>
                  Run
                </button>
                <button type="button" onClick={() => onToggleEnabled(agent)} className={ROSTER_ACTION_CLASS}>
                  {agent.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(agent.agent_id)}
                  className="rounded-md border border-negative px-3 py-1.5 text-xs font-medium text-negative"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Fleet health one-liner under the roster heading — the monitor-first read
// before the agent rows.
function FleetSummary({ fleet }: { fleet: { total: number; enabled: number; running: number; failing: number } }) {
  return (
    <p className="mt-1 text-xs text-muted">
      <span className="num">{fleet.total}</span> {fleet.total === 1 ? 'monitor' : 'monitors'} ·{' '}
      <span className="num">{fleet.enabled}</span> enabled
      {fleet.running > 0 ? (
        <>
          {' · '}
          <span className="num text-warning">{fleet.running}</span> running
        </>
      ) : null}
      {fleet.failing > 0 ? (
        <>
          {' · '}
          <span className="num text-negative">{fleet.failing}</span> failing
        </>
      ) : null}
    </p>
  )
}

const RUN_STATUS_FILL: Readonly<Record<RunStatus, string>> = {
  completed: 'bg-positive',
  failed: 'bg-negative',
  running: 'bg-warning',
}

function StatusDot({ status }: { status: RunStatus | null }) {
  const fill = status === null ? 'bg-faint' : RUN_STATUS_FILL[status]
  return (
    <span
      aria-hidden="true"
      title={status ?? 'never run'}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${fill}`}
    />
  )
}

// Per-agent run history as colored ticks (green completed / red failed / amber
// running), oldest→newest — the signature monitor visual the text "Run history"
// list was impersonating.
function RunTimeline({ ticks }: { ticks: ReadonlyArray<RunStatus> }) {
  if (ticks.length === 0) {
    return <p className="mt-2 text-[10px] uppercase tracking-wide text-faint">No runs yet</p>
  }
  return (
    <div className="mt-2 flex items-end gap-0.5" role="img" aria-label={`Last ${ticks.length} runs`}>
      {ticks.map((status, i) => (
        <span key={i} className={`h-3.5 w-1.5 rounded-sm ${RUN_STATUS_FILL[status]}`} />
      ))}
    </div>
  )
}
