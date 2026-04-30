import type { ReactElement } from 'react'

type BlockSkeletonProps = {
  blockId: string
  kind: string
}

// A pulse-animated placeholder rendered while a streaming block has no
// content yet. Heights are chosen per kind to roughly match the final block
// so layout doesn't jump when content arrives.
export function BlockSkeleton({ blockId, kind }: BlockSkeletonProps): ReactElement {
  const heightClass = SKELETON_HEIGHT_BY_KIND[kind] ?? 'h-12'
  return (
    <div
      data-testid={`block-skeleton-${blockId}`}
      data-block-kind={kind}
      data-block-status="pending"
      className={`${heightClass} animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-800`}
    />
  )
}

const SKELETON_HEIGHT_BY_KIND: Record<string, string> = {
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
