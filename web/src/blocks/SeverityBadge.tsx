import type { ReactElement, ReactNode } from 'react'
import { Badge } from './Badge.tsx'
import { severityBadgeClass } from './severityTone.ts'
import type { FindingSeverity } from './types.ts'

// Severity pill built on the base Badge with the canonical severity tone map.
// Accepts the full FindingSeverity set; the fact-review queue passes a subset.
// Defaults its label to the capitalized severity (matching FindingCard).
export function SeverityBadge({
  severity,
  children,
  testId,
}: {
  severity: FindingSeverity
  children?: ReactNode
  testId?: string
}): ReactElement {
  return (
    <Badge toneClass={`font-semibold uppercase tracking-wide ${severityBadgeClass(severity)}`} testId={testId}>
      {children ?? severity[0].toUpperCase() + severity.slice(1)}
    </Badge>
  )
}
