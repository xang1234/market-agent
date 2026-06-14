import type { ReactElement } from 'react'

export type VerticalBar = {
  key: string
  value: number
  // Fill class, default bg-accent. Per-bar so callers can colour-band (e.g. the
  // confidence histogram shades by distance from the threshold).
  className?: string
  title?: string
}

// A row of vertical bars with heights normalized to the largest value — the
// shared primitive behind the Screener metric distribution, the Review
// confidence histogram, and the Signals mention-volume strip, which all
// hand-rolled `flex items-end` + `height = value/max`. A non-zero bar gets at
// least `minBarPct` height so it stays visible; a zero bar collapses to nothing.
// Decorative by default (aria-hidden); pass `ariaLabel` to expose it as an image.
export function VerticalBars({
  bars,
  heightClass = 'h-10',
  minBarPct = 6,
  ariaLabel,
}: {
  bars: ReadonlyArray<VerticalBar>
  heightClass?: string
  minBarPct?: number
  ariaLabel?: string
}): ReactElement {
  const max = bars.reduce((m, b) => Math.max(m, b.value), 0)
  const a11y = ariaLabel ? { role: 'img' as const, 'aria-label': ariaLabel } : { 'aria-hidden': true }
  return (
    <div className={`flex items-end gap-0.5 ${heightClass}`} {...a11y}>
      {bars.map((bar) => (
        <span
          key={bar.key}
          title={bar.title}
          className={`flex-1 rounded-t-sm ${bar.className ?? 'bg-accent'}`}
          style={{ height: `${max === 0 ? 0 : Math.max(bar.value === 0 ? 0 : minBarPct, (bar.value / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}
