import {
  isSubjectKind,
  isSubjectRef,
  isUuid,
  parseSubjectRefString,
  type SubjectKind,
  type SubjectRef,
} from '../subject/subjectRef.ts'

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
  subjectKind: SubjectKind
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

export class AgentPayloadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentPayloadValidationError'
  }
}

type ExistingAgentPolicy = {
  universe?: unknown
  alert_rules?: ReadonlyArray<AgentAlertRule>
}

export function buildAgentPayload(
  state: AgentFormState,
  existing?: ExistingAgentPolicy,
): AgentPayload {
  const preservedUniverse: unknown =
    existing?.universe !== undefined && !canRoundTripUniverse(existing.universe) ? existing.universe : null
  const universe = preservedUniverse ?? buildUniverse(state)
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
  return {
    name: state.name.trim(),
    thesis: state.thesis.trim(),
    cadence: state.cadence,
    universe,
    alert_rules: preservedAlertRules ?? alertRules,
  }
}

export function canRoundTripUniverse(universe: unknown): boolean {
  if (universe === undefined) return true
  if (!isRecord(universe) || typeof universe.mode !== 'string') return false
  if (universe.mode === 'static') {
    return Array.isArray(universe.subject_refs) && universe.subject_refs.every(isSubjectRef)
  }
  if (universe.mode === 'screen') return isUuid(universe.screen_id)
  if (universe.mode === 'theme') return isUuid(universe.theme_id)
  if (universe.mode === 'portfolio') return isUuid(universe.portfolio_id)
  if (universe.mode === 'agent') return isUuid(universe.agent_id)
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
    const quickRef = { kind: state.subjectKind, id: state.subjectId.trim() }
    if (quickRef.id.length > 0 && !isSubjectRef(quickRef)) {
      throw new AgentPayloadValidationError('Static subject id must be a UUID')
    }
    return {
      mode: 'static',
      subject_refs: quickRef.id.length > 0 ? [quickRef] : [],
    }
  }

  const id = state.dynamicUniverseId.trim()
  if (!isUuid(id)) throw new AgentPayloadValidationError(`${state.universeMode} universe id must be a UUID`)
  if (state.universeMode === 'screen') return { mode: 'screen', screen_id: id }
  if (state.universeMode === 'theme') return { mode: 'theme', theme_id: id }
  if (state.universeMode === 'portfolio') return { mode: 'portfolio', portfolio_id: id }
  return { mode: 'agent', agent_id: id }
}

function parseSubjectRefsText(value: string): ReadonlyArray<SubjectRef> {
  return value
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, lineNumber }) => {
      const parsed = parseManualSubjectRefLine(line)
      if (parsed !== null) return parsed
      throw new AgentPayloadValidationError(`Static subject ref line ${lineNumber} must be kind:uuid`)
    })
}

function parseManualSubjectRefLine(line: string): SubjectRef | null {
  const canonical = parseSubjectRefString(line)
  if (canonical !== null) return canonical
  const separator = line.indexOf(':')
  if (separator <= 0) return null
  const candidate = {
    kind: line.slice(0, separator).trim(),
    id: line.slice(separator + 1).trim(),
  }
  return isSubjectRef(candidate) ? candidate : null
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isAgentSubjectKind(value: unknown): value is SubjectKind {
  return isSubjectKind(value)
}
