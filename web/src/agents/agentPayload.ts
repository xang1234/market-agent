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
  [key: string]: unknown
}

export type AgentFormState = {
  name: string
  thesis: string
  cadence: string
  universeMode: AgentUniverse['mode']
  staticSubjectRefsText: string
  dynamicUniverseId: string
  subjectKind: string
  subjectId: string
  alertRuleId: string
  alertSeverity: string
  alertHeadline: string
  alertEmail: boolean
  alertWebPush: boolean
  alertSms: boolean
  alertMobilePush: boolean
  alertDigest: boolean
}

export type AgentPayload = {
  name: string
  thesis: string
  cadence: string
  universe: unknown
  alert_rules: ReadonlyArray<AgentAlertRule>
}

type ExistingAgentPolicy = {
  universe?: unknown
  alert_rules?: ReadonlyArray<AgentAlertRule>
}

export function buildAgentPayload(
  state: AgentFormState,
  existing?: ExistingAgentPolicy,
): AgentPayload {
  const universe = buildUniverse(state)
  const channels = selectedChannels(state)
  const alertRules = state.alertRuleId.trim()
    ? [
        {
          rule_id: state.alertRuleId.trim(),
          severity_at_least: state.alertSeverity,
          ...(state.alertHeadline.trim() ? { headline_contains: state.alertHeadline.trim() } : {}),
          channels,
        },
      ]
    : []
  const preservedAlertRules: ReadonlyArray<AgentAlertRule> | null =
    existing?.alert_rules !== undefined && !canRoundTripAlertRules(existing.alert_rules) ? existing.alert_rules : null
  const preservedUniverse: unknown =
    existing?.universe !== undefined && !canRoundTripUniverse(existing.universe) ? existing.universe : null
  return {
    name: state.name.trim(),
    thesis: state.thesis.trim(),
    cadence: state.cadence,
    universe: preservedUniverse ?? universe,
    alert_rules: preservedAlertRules ?? alertRules,
  }
}

export function canRoundTripUniverse(universe: unknown): boolean {
  if (universe === undefined) return true
  if (!isRecord(universe) || typeof universe.mode !== 'string') return false
  if (universe.mode === 'static') {
    return Array.isArray(universe.subject_refs) && universe.subject_refs.every(isSubjectRef)
  }
  if (universe.mode === 'screen') return typeof universe.screen_id === 'string'
  if (universe.mode === 'theme') return typeof universe.theme_id === 'string'
  if (universe.mode === 'portfolio') return typeof universe.portfolio_id === 'string'
  if (universe.mode === 'agent') return typeof universe.agent_id === 'string'
  return false
}

export function canRoundTripAlertRules(alertRules: ReadonlyArray<AgentAlertRule> | undefined): boolean {
  return alertRules === undefined || (
    alertRules.length <= 1 &&
    alertRules.every((rule) => {
      const editableKeys = new Set(['rule_id', 'severity_at_least', 'headline_contains', 'channels'])
      return Object.keys(rule).every((key) => editableKeys.has(key)) &&
        typeof rule.rule_id === 'string' &&
        (rule.severity_at_least === undefined || typeof rule.severity_at_least === 'string') &&
        (rule.headline_contains === undefined || typeof rule.headline_contains === 'string') &&
        (rule.channels === undefined || (Array.isArray(rule.channels) && rule.channels.every((channel) => typeof channel === 'string')))
    })
  )
}

export function subjectRefsText(subjectRefs: ReadonlyArray<SubjectRef> | undefined): string {
  return (subjectRefs ?? []).map((ref) => `${ref.kind}:${ref.id}`).join('\n')
}

function buildUniverse(state: AgentFormState): AgentUniverse {
  if (state.universeMode === 'static') {
    const refs = parseSubjectRefsText(state.staticSubjectRefsText)
    if (refs.length > 0) return { mode: 'static', subject_refs: refs }
    return {
      mode: 'static',
      subject_refs: state.subjectId.trim() ? [{ kind: state.subjectKind, id: state.subjectId.trim() }] : [],
    }
  }

  const id = state.dynamicUniverseId.trim()
  if (state.universeMode === 'screen') return { mode: 'screen', screen_id: id }
  if (state.universeMode === 'theme') return { mode: 'theme', theme_id: id }
  if (state.universeMode === 'portfolio') return { mode: 'portfolio', portfolio_id: id }
  return { mode: 'agent', agent_id: id }
}

function parseSubjectRefsText(value: string): ReadonlyArray<SubjectRef> {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':')
      if (separator === -1) return { kind: 'issuer', id: line }
      return {
        kind: line.slice(0, separator).trim(),
        id: line.slice(separator + 1).trim(),
      }
    })
    .filter((ref) => ref.kind.length > 0 && ref.id.length > 0)
}

function selectedChannels(state: AgentFormState): ReadonlyArray<string> {
  return [
    ...(state.alertEmail ? ['email'] : []),
    ...(state.alertWebPush ? ['web_push'] : []),
    ...(state.alertSms ? ['sms'] : []),
    ...(state.alertMobilePush ? ['mobile_push'] : []),
    ...(state.alertDigest ? ['digest'] : []),
  ]
}

function isSubjectRef(value: unknown): value is SubjectRef {
  return isRecord(value) && typeof value.kind === 'string' && typeof value.id === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
