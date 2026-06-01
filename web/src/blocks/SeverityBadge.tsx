import type { ReactElement, ReactNode } from 'react'
import { Badge } from './Badge.tsx'

// Severity pill for the fact-review queue (and any high/medium/low signal).
// Generalizes the base Badge with a severity→tone map: high reads as negative,
// medium as warning, low as a muted neutral. Tones are soft-bg + signed text
// so they stay legible in both themes.
export type Severity = 'high' | 'medium' | 'low'

const SEVERITY_TONE: Readonly<Record<Severity, string>> = {
  high: 'bg-negative-soft text-negative',
  medium: 'bg-warning-soft text-warning',
  low: 'bg-surface-2 text-muted',
}

const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function SeverityBadge({
  severity,
  children,
  testId,
}: {
  severity: Severity
  children?: ReactNode
  testId?: string
}): ReactElement {
  return (
    <Badge toneClass={`font-semibold uppercase tracking-wide ${SEVERITY_TONE[severity]}`} testId={testId}>
      {children ?? SEVERITY_LABEL[severity]}
    </Badge>
  )
}
