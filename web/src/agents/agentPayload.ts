export type SubjectRef = {
  kind: string
  id: string
}

export type AgentUniverse =
  | { mode: 'static'; subject_refs: ReadonlyArray<SubjectRef> }
  | { mode: 'screen'; screen_id: string }
  | { mode: 'theme'; theme_id: string }
  | { mode: 'portfolio'; portfolio_id: string }
  | { mode: 'agent'; agent_id: string }

export type AgentAlertRule = {
  rule_id: string
  severity_at_least?: string
  headline_contains?: string
  channels?: ReadonlyArray<string>
}

export type AgentFormState = {
  name: string
  thesis: string
  cadence: string
  subjectKind: string
  subjectId: string
  alertRuleId: string
  alertSeverity: string
  alertHeadline: string
  alertEmail: boolean
}

export type AgentPayload = {
  name: string
  thesis: string
  cadence: string
  universe: AgentUniverse
  alert_rules: ReadonlyArray<AgentAlertRule>
}

type ExistingAgentPolicy = {
  universe?: AgentUniverse
  alert_rules?: ReadonlyArray<AgentAlertRule>
}

export function buildAgentPayload(
  state: AgentFormState,
  existing?: ExistingAgentPolicy,
): AgentPayload {
  const subjectRef = state.subjectId.trim()
    ? [{ kind: state.subjectKind, id: state.subjectId.trim() }]
    : []
  const alertRules = state.alertRuleId.trim()
    ? [
        {
          rule_id: state.alertRuleId.trim(),
          severity_at_least: state.alertSeverity,
          ...(state.alertHeadline.trim() ? { headline_contains: state.alertHeadline.trim() } : {}),
          channels: state.alertEmail ? ['email'] : [],
        },
      ]
    : []
  const preservedUniverse: AgentUniverse | null =
    existing?.universe !== undefined && !canRoundTripUniverse(existing.universe) ? existing.universe : null
  const preservedAlertRules: ReadonlyArray<AgentAlertRule> | null =
    existing?.alert_rules !== undefined && !canRoundTripAlertRules(existing.alert_rules) ? existing.alert_rules : null
  return {
    name: state.name.trim(),
    thesis: state.thesis.trim(),
    cadence: state.cadence,
    universe: preservedUniverse ?? { mode: 'static', subject_refs: subjectRef },
    alert_rules: preservedAlertRules ?? alertRules,
  }
}

export function canRoundTripUniverse(universe: AgentUniverse | undefined): boolean {
  return universe === undefined || (universe.mode === 'static' && universe.subject_refs.length <= 1)
}

export function canRoundTripAlertRules(alertRules: ReadonlyArray<AgentAlertRule> | undefined): boolean {
  return alertRules === undefined || alertRules.length <= 1
}
