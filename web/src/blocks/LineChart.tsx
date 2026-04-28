import type { ReactElement } from 'react'
import type { LineChartBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { SeriesChart } from './SeriesChart.tsx'

type LineChartProps = { block: LineChartBlock }

export function LineChart({ block }: LineChartProps): ReactElement {
  return (
    <ChartCard
      testId={`block-line-chart-${block.id}`}
      blockKind="line_chart"
      title={block.title}
      dataAttrs={{ 'data-x-type': block.x_type }}
    >
      <SeriesChart
        testId={`block-line-chart-${block.id}-svg`}
        ariaLabel={block.title ?? 'Line chart'}
        series={block.series}
      />
      {block.y_format ? (
        <figcaption
          data-testid={`block-line-chart-${block.id}-y-format`}
          className="text-xs text-neutral-500 dark:text-neutral-400"
        >
          y-axis: {block.y_format}
        </figcaption>
      ) : null}
    </ChartCard>
  )
}
