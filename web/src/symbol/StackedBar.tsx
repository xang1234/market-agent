import type { ReactElement, ReactNode } from 'react'

export type StackedSegment = {
  key: string
  // Raw magnitude; segment widths are this as a share of the segment sum.
  value: number
  // Fill class for the segment / its legend dot, e.g. severityFillClass(sev).
  className: string
  // Only the legend renders a label; bar-only callers (consensus, insider split)
  // omit it.
  label?: string
  // Optional hover tooltip and test hook on the segment.
  title?: string
  testId?: string
}

// Horizontal stacked proportion bar — a track of colored segments whose widths
// sum to 100%. The shared primitive behind the Review/Home severity bars, the
// analyst-consensus rating bar, and the insider buy/sell split. Zero-value
// segments collapse to nothing; `heightClass` tunes the track thickness.
export function StackedBar({
  segments,
  ariaLabel,
  heightClass = 'h-3.5',
}: {
  segments: ReadonlyArray<StackedSegment>
  ariaLabel: string
  heightClass?: string
}): ReactElement {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  return (
    <div className={`flex overflow-hidden rounded-sm bg-surface-2 ${heightClass}`} role="img" aria-label={ariaLabel}>
      {segments.map((s) =>
        s.value > 0 ? (
          <span
            key={s.key}
            data-testid={s.testId}
            title={s.title}
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
