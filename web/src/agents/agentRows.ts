import type { AgentAlertRule, AgentUniverse } from './agentPayload.ts'

// Wire shapes for the Agents surface, shared by AgentsPage (state + form) and
// the extracted AgentRoster / AgentDetailPanels presenters. Lives here (not in
// the page) so the presenters don't import back through the page component.
export type AgentRow = {
  agent_id: string
  name: string
  thesis: string
  cadence: string
  enabled: boolean
  universe?: AgentUniverse
  alert_rules?: ReadonlyArray<AgentAlertRule>
  updated_at: string
}

export type AgentRunRow = {
  agent_run_log_id: string
  agent_id: string
  status: 'running' | 'completed' | 'failed'
  started_at: string
  ended_at: string | null
  error: string | null
}

export type AgentFindingRow = {
  finding_id: string
  agent_id: string
  snapshot_id: string
  headline: string
  severity: string
  created_at: string
}

export type AgentActivityRow = {
  run_activity_id: string
  agent_id: string
  stage: string
  summary: string
  ts: string
}
