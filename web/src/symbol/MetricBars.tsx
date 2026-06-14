import type { ReactElement } from 'react'

import { SIGNED_TEXT_CLASS, type SignedDirection } from './signedColor.ts'

export type MetricBar = {
  key: string
  label: string
  // 0..1 of the row set's max — drives the fill width.
  fraction: number
  value: string
  // Optional signed delta shown at the right (YoY / period-over-period). Text
  // and direction travel together so a half-set state isn't representable.
  delta?: { text: string; direction: SignedDirection }
}

// Horizontal labelled bars — the charts-first primitive shared by the
// Financials revenue trend and the Holders ownership view. Fill width is the
// value's share of the row set's max; an optional signed delta sits at the
// right.
export function MetricBars({
  bars,
  fillClass = 'bg-positive',
  testId,
  ariaLabel,
}: {
  bars: ReadonlyArray<MetricBar>
  fillClass?: string
  testId?: string
  ariaLabel?: string
}): ReactElement {
  return (
    <ul data-testid={testId} aria-label={ariaLabel} className="flex flex-col gap-1.5">
      {bars.map((bar) => (
        <li key={bar.key} data-testid={testId ? `${testId}-${bar.key}` : undefined} className="flex items-center gap-3 text-xs">
          <span className="num w-14 shrink-0 text-muted">{bar.label}</span>
          <span className="h-3.5 flex-1 overflow-hidden rounded-sm bg-surface-2">
            <span
              className={`block h-full rounded-sm ${fillClass}`}
              style={{ width: `${Math.max(0, Math.min(1, bar.fraction)) * 100}%` }}
            />
          </span>
          <span className="num w-20 shrink-0 text-right text-fg">{bar.value}</span>
          <span
            className={`num w-12 shrink-0 text-right ${
              bar.delta ? SIGNED_TEXT_CLASS[bar.delta.direction] : 'text-faint'
            }`}
          >
            {bar.delta?.text ?? ''}
          </span>
        </li>
      ))}
    </ul>
  )
}
