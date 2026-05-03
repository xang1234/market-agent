import type { ReactElement } from 'react'
import type { SentimentTrendBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { SeriesChart } from './SeriesChart.tsx'
import {
  seriesCacheContract,
  socialSeriesSummary,
} from './socialNewsBlocks.ts'

type SentimentTrendProps = { block: SentimentTrendBlock }

export function SentimentTrend({ block }: SentimentTrendProps): ReactElement {
  const summary = socialSeriesSummary(block)
  const cache = seriesCacheContract(block)
  return (
    <ChartCard
      testId={`block-sentiment-trend-${block.id}`}
      blockKind="sentiment_trend"
      title={block.title}
      dataAttrs={{ 'data-series-refs': cache.seriesRefs.join(',') }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs uppercase text-neutral-500 dark:text-neutral-400">
          {summary.latestLabel}
        </span>
        <span className="text-lg font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
          {summary.latestValue}
        </span>
      </div>
      <SeriesChart
        testId={`block-sentiment-trend-${block.id}-svg`}
        ariaLabel={block.title ?? 'Sentiment trend'}
        series={block.series}
      />
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {summary.pointCount} observations
        {cache.allowedRanges.length > 0 ? ` · ranges: ${cache.allowedRanges.join(', ')}` : ''}
      </p>
    </ChartCard>
  )
}
