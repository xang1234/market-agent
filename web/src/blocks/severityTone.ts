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
