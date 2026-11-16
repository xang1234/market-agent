import type { AgentRow } from './agentRows.ts'

// Human-readable summaries of an agent's universe / alert config. Shared by the
// roster rows (display) and the form (the "preserved by this edit" warnings),
// so they live here rather than in either consumer.
export function universeLabel(universe: AgentRow['universe'], names: ReadonlyMap<string, string> = new Map()): string {
  if (!universe) return 'not configured'
  if (universe.mode === 'static') {
    if (universe.subject_refs.length === 0) return 'static empty'
    return universe.subject_refs.map((ref) => `${ref.kind}: ${ref.id}`).join(', ')
  }
  const id = dynamicUniverseIdFor(universe)
  return `${universe.mode}: ${names.get(id) ?? id}`
}

export function alertRuleLabel(alertRules: AgentRow['alert_rules']): string {
  const rule = alertRules?.[0]
  if (!rule) return 'not configured'
  const severity = rule.severity_at_least ?? 'any'
  const headline = rule.headline_contains ? ` headline contains ${rule.headline_contains}` : ''
  const channels = rule.channels?.length ? ` via ${rule.channels.join(', ')}` : ''
  return `${severity}+${headline}${channels}`.trim()
}

// The dynamic-universe id for the form's edit-prefill (static universes have no
// single id).
export function dynamicUniverseIdFor(universe: AgentRow['universe']): string {
  if (!universe || universe.mode === 'static') return ''
  if (universe.mode === 'screen') return universe.screen_id
  if (universe.mode === 'theme') return universe.theme_id
  if (universe.mode === 'watchlist') return universe.watchlist_id
  if (universe.mode === 'portfolio') return universe.portfolio_id
  return universe.agent_id
}
