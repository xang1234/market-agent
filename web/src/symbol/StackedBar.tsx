import type { ReactElement } from 'react'

export type StackedBarSegment = {
  label: string
  value: number
  // Tailwind bg-* class for the filled segment; pass a token-based class
  // (e.g. bg-positive) so the bar flips with the theme.
  barClass: string
  // Optional text-* class for this segment's legend entry. Defaults to muted.
  labelClass?: string
}

// Horizontal segmented bar for a part-to-whole split — the analyst-rating
// distribution (Strong Buy → Sell) and similar. Segment widths are
// proportional to value; a legend row below names each segment with its count.
// A zero total renders an empty track instead of dividing by zero.
export function StackedBar({
  segments,
  ariaLabel,
}: {
  segments: ReadonlyArray<StackedBarSegment>
  ariaLabel?: string
}): ReactElement {
  const total = segments.reduce((sum, seg) => sum + Math.max(0, seg.value), 0)
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-2.5 overflow-hidden rounded-md bg-surface-2"
        role="img"
        aria-label={ariaLabel}
      >
        {total > 0
          ? segments.map((seg, index) =>
              seg.value > 0 ? (
                <div
                  key={index}
                  className={seg.barClass}
                  style={{ width: `${(seg.value / total) * 100}%` }}
                />
              ) : null,
            )
          : null}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {segments.map((seg, index) => (
          <li key={index} className={seg.labelClass ?? 'text-muted'}>
            {seg.label} <span className="num">{seg.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
