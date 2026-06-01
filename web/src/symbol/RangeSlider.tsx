import type { ReactElement } from 'react'

// Low / current / high marker bar — the price-target range. Renders a track
// filled up to `current`'s position with a marker dot there, and low / current
// / high labels below. The marker ratio is clamped to [0,1] so a current value
// outside the band still renders at an edge instead of overflowing the track.
export function RangeSlider({
  low,
  current,
  high,
  lowLabel,
  currentLabel,
  highLabel,
  ariaLabel,
}: {
  low: number
  current: number
  high: number
  lowLabel: string
  currentLabel: string
  highLabel: string
  ariaLabel?: string
}): ReactElement {
  const span = high - low
  const ratio = span > 0 ? Math.min(1, Math.max(0, (current - low) / span)) : 0
  const pct = `${ratio * 100}%`
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-1.5 rounded-md bg-surface-2" role="img" aria-label={ariaLabel}>
        <div className="h-full rounded-md bg-positive" style={{ width: pct }} />
        <span
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg ring-2 ring-surface"
          style={{ left: pct }}
        />
      </div>
      <div className="num flex justify-between text-xs text-muted">
        <span>{lowLabel}</span>
        <span className="text-fg">{currentLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  )
}
