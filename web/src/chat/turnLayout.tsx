import type { HTMLAttributes, ReactElement, ReactNode } from 'react'

// Single source of truth for chat turn presentation. A streaming turn and the
// persisted turn it becomes are the SAME message at two moments in its life —
// the stream seals and re-renders through MessageItem. Sharing these wrappers
// keeps the two paths pixel-identical, so the turn doesn't visually jump at the
// seal moment, and the width/card styling can't drift between them.

// Outer thread column — left-aligned, wide enough to host breakout data blocks.
export const THREAD_COLUMN_CLASS = 'w-full max-w-[960px]'

// Prose blocks (rich_text, section, metric_row, text-ish evidence cards) get a
// narrower reading column that left-aligns within the thread column.
export const PROSE_COLUMN_CLASS = 'w-full max-w-[680px]'

// Data artifacts (charts, tables, comparisons, consensus) break out to the
// full thread column width for comfortable data display.
export const BREAKOUT_COLUMN_CLASS = 'w-full max-w-[960px]'

// The set of block kinds that should render at breakout (960px) width.
// All other kinds fall back to PROSE_COLUMN_CLASS (680px).
export const WIDE_BLOCK_KINDS: ReadonlySet<string> = new Set<string>([
  // Chart / comparison kinds
  'line_chart',
  'revenue_bars',
  'perf_comparison',
  'segment_donut',
  'segment_trajectory',
  'metrics_comparison',
  'sentiment_trend',
  'mention_volume',
  // Tabular narrative layout
  'table',
  // Research evidence blocks that are data-dense
  'analyst_consensus',
  'price_target_range',
  'eps_surprise',
  'filings_list',
])

export function isWideBlock(kind: string): boolean {
  return WIDE_BLOCK_KINDS.has(kind)
}

/** Wraps a block in the column width appropriate for its kind. */
export function BlockColumn({
  kind,
  children,
}: {
  kind: string
  children: ReactNode
}): ReactElement {
  return <div className={isWideBlock(kind) ? BREAKOUT_COLUMN_CLASS : PROSE_COLUMN_CLASS}>{children}</div>
}

export function ThreadColumn({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`${THREAD_COLUMN_CLASS} ${className}`.trim()}>{children}</div>
}

// Assistant turns get the full answer canvas; the user's turn stays a compact
// bubble (USER_BUBBLE_CLASS). Extra div props pass through so callers can attach
// test ids / data attributes without re-declaring the styling.
export function AssistantTurn({
  children,
  className = '',
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-md ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  )
}

// The sent-message bubble gradient is intentionally theme-independent so it
// reads as "your message" in both light and dark.
export const USER_BUBBLE_CLASS =
  'max-w-[80%] rounded-2xl rounded-br-md border border-[#244a6e] bg-linear-to-b from-[#1d3a59] to-[#16314c] px-3.5 py-2.5 text-[#dcebff] shadow-md'
