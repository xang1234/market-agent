import type { FindingSeverity } from './types.ts'

// Canonical severity → badge tone map. Single source for both research findings
// (FindingCard) and the fact-review queue (SeverityBadge), keyed by the full
// FindingSeverity set; review severities are a subset. Soft-bg + signed text so
// the four levels stay legible and distinct in both themes.
export const SEVERITY_BADGE_CLASS: Readonly<Record<FindingSeverity, string>> = {
  low: 'bg-surface-2 text-muted',
  medium: 'bg-warning-soft text-warning',
  high: 'bg-negative-soft text-negative',
  critical: 'bg-negative text-white',
}

export function severityBadgeClass(severity: FindingSeverity): string {
  return SEVERITY_BADGE_CLASS[severity]
}

// Canonical severity → solid fill, for stacked severity bars (Home findings,
// Review queue). A bar needs four *distinct* hues to show the mix, so this
// deliberately diverges from the badge map (which uses red for both high and
// critical, distinguished by intensity + label — fine for a pill, ambiguous as
// adjacent bar segments). Red is reserved for `critical`; review severities
// never reach it, so a review bar tops out at amber.
export const SEVERITY_FILL_CLASS: Readonly<Record<FindingSeverity, string>> = {
  low: 'bg-muted',
  medium: 'bg-accent',
  high: 'bg-warning',
  critical: 'bg-negative',
}

export function severityFillClass(severity: FindingSeverity): string {
  return SEVERITY_FILL_CLASS[severity]
}
