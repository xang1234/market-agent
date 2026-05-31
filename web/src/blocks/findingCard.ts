import type { FindingSeverity } from './types.ts'

const SEVERITY_BADGE_CLASS: Readonly<Record<FindingSeverity, string>> = {
  low: 'bg-surface-2 text-muted',
  medium: 'bg-warning-soft text-warning',
  high: 'bg-negative-soft text-negative',
  critical: 'bg-negative text-white',
}

export function findingSeverityBadgeClass(severity: FindingSeverity): string {
  return SEVERITY_BADGE_CLASS[severity]
}
