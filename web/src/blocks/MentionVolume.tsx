import type { ReactElement } from 'react'
import type { MentionVolumeBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { SeriesChart } from './SeriesChart.tsx'

type MentionVolumeProps = { block: MentionVolumeBlock }

export function MentionVolume({ block }: MentionVolumeProps): ReactElement {
  return (
    <ChartCard
      testId={`block-mention-volume-${block.id}`}
      blockKind="mention_volume"
      title={block.title}
    >
      <SeriesChart
        testId={`block-mention-volume-${block.id}-svg`}
        ariaLabel={block.title ?? 'Mention volume'}
        series={block.series}
      />
    </ChartCard>
  )
}
