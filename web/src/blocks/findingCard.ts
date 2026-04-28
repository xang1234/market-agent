import type { FindingSeverity } from './types.ts'

const SEVERITY_BADGE_CLASS: Readonly<Record<FindingSeverity, string>> = {
  low: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  critical: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
}

export function findingSeverityBadgeClass(severity: FindingSeverity): string {
  return SEVERITY_BADGE_CLASS[severity]
}
