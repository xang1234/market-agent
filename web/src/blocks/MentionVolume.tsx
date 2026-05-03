import type { ReactElement } from 'react'
import type { MentionVolumeBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { SeriesChart } from './SeriesChart.tsx'
import {
  MENTION_VOLUME_DISCLOSURE,
  seriesCacheContract,
  socialSeriesSummary,
} from './socialNewsBlocks.ts'

type MentionVolumeProps = { block: MentionVolumeBlock }

export function MentionVolume({ block }: MentionVolumeProps): ReactElement {
  const summary = socialSeriesSummary(block)
  const cache = seriesCacheContract(block)
  return (
    <ChartCard
      testId={`block-mention-volume-${block.id}`}
      blockKind="mention_volume"
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
        testId={`block-mention-volume-${block.id}-svg`}
        ariaLabel={block.title ?? 'Mention volume'}
        series={block.series}
      />
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {summary.total === null ? summary.pointCount : summary.total.toLocaleString('en-US')} total mentions
        {cache.allowedRanges.length > 0 ? ` · ranges: ${cache.allowedRanges.join(', ')}` : ''}
      </p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {MENTION_VOLUME_DISCLOSURE}
      </p>
    </ChartCard>
  )
}
