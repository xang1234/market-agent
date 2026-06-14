import type { ReactElement, ReactNode } from 'react'

export type StackedSegment = {
  key: string
  // Raw magnitude; segment widths are this as a share of the segment sum.
  value: number
  label: string
  // Fill class for the segment / its legend dot, e.g. severityFillClass(sev).
  className: string
}

// Horizontal stacked proportion bar — a track of colored segments whose widths
// sum to 100%. The shared primitive behind the Review severity bar, the Home
// findings-severity bar, and (future) the analyst-consensus / insider-flow
// splits, which all hand-rolled this. Zero-value segments collapse to nothing.
export function StackedBar({
  segments,
  ariaLabel,
}: {
  segments: ReadonlyArray<StackedSegment>
  ariaLabel: string
}): ReactElement {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  return (
    <div
      className="flex h-3.5 overflow-hidden rounded-sm bg-surface-2"
      role="img"
      aria-label={ariaLabel}
    >
      {segments.map((s) =>
        s.value > 0 ? (
          <span
            key={s.key}
            className={`block h-full ${s.className}`}
            style={{ width: `${total === 0 ? 0 : (s.value / total) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  )
}

// Dot + label + value legend for a StackedBar's segments. `leading` slots an
// optional node (e.g. a total) before the items; the caller decides whether to
// pass every segment or only the non-zero ones.
export function StackedBarLegend({
  segments,
  leading,
}: {
  segments: ReadonlyArray<StackedSegment>
  leading?: ReactNode
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs num text-muted">
      {leading}
      {segments.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-sm ${s.className}`} />
          {s.label} {s.value}
        </span>
      ))}
    </div>
  )
}
