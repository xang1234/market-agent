// Pure layout helpers — no React dependency.
// Extracted from turnLayout.tsx so that the component file doesn't export
// non-component symbols (react-refresh/only-export-components lint rule).

// Prose blocks (rich_text, section, metric_row, text-ish evidence cards) get a
// reading column that left-aligns within the thread column. Sized to fit a
// typical 4-5 column financial table, because grounded analyst answers emit GFM
// tables INSIDE a rich_text block (prose-kind, not the wide `table` block kind).
// Markdown tables wider than this still scroll via the table renderer's
// overflow-x-auto.
export const PROSE_COLUMN_CLASS = 'w-full max-w-[820px]'

// Data artifacts (charts, tables, comparisons, consensus) break out to the
// full thread column width for comfortable data display.
export const BREAKOUT_COLUMN_CLASS = 'w-full max-w-[960px]'

// The set of block kinds that should render at breakout (960px) width.
// All other kinds fall back to PROSE_COLUMN_CLASS (820px).
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
