// Per-kind skeleton heights chosen to roughly match the final block so the
// layout doesn't jump when content arrives. Drift-tested against the
// catalog kind-group constants in blocks/types.ts.
export const SKELETON_HEIGHT_BY_KIND: Record<string, string> = {
  rich_text: 'h-6',
  metric_row: 'h-16',
  table: 'h-40',
  line_chart: 'h-56',
  revenue_bars: 'h-56',
  perf_comparison: 'h-56',
  segment_donut: 'h-56',
  segment_trajectory: 'h-56',
  metrics_comparison: 'h-40',
  analyst_consensus: 'h-32',
  price_target_range: 'h-24',
  eps_surprise: 'h-32',
  filings_list: 'h-40',
  news_cluster: 'h-32',
  finding_card: 'h-32',
  sentiment_trend: 'h-40',
  mention_volume: 'h-40',
  sources: 'h-20',
  disclosure: 'h-12',
  section: 'h-24',
}

export const DEFAULT_SKELETON_HEIGHT = 'h-12'
