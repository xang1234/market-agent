import type { ReactElement } from 'react'
import type { SegmentTrajectoryBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { SeriesChart } from './SeriesChart.tsx'

type SegmentTrajectoryProps = { block: SegmentTrajectoryBlock }

export function SegmentTrajectory({ block }: SegmentTrajectoryProps): ReactElement {
  return (
    <ChartCard
      testId={`block-segment-trajectory-${block.id}`}
      blockKind="segment_trajectory"
      title={block.title}
    >
      <SeriesChart
        testId={`block-segment-trajectory-${block.id}-svg`}
        ariaLabel={block.title ?? 'Segment trajectory'}
        series={block.series}
      />
    </ChartCard>
  )
}
