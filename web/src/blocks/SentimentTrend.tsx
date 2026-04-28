import type { ReactElement } from 'react'
import type { SentimentTrendBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { SeriesChart } from './SeriesChart.tsx'

type SentimentTrendProps = { block: SentimentTrendBlock }

export function SentimentTrend({ block }: SentimentTrendProps): ReactElement {
  return (
    <ChartCard
      testId={`block-sentiment-trend-${block.id}`}
      blockKind="sentiment_trend"
      title={block.title}
    >
      <SeriesChart
        testId={`block-sentiment-trend-${block.id}-svg`}
        ariaLabel={block.title ?? 'Sentiment trend'}
        series={block.series}
      />
    </ChartCard>
  )
}
