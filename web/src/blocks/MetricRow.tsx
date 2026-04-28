import type { ReactElement } from 'react'
import type { MetricCell, MetricRowBlock } from './types.ts'
import { metricCellDisplayValue, metricCellHasDelta } from './metricRow.ts'

type MetricRowProps = { block: MetricRowBlock }

export function MetricRow({ block }: MetricRowProps): ReactElement {
  return (
    <ul
      data-testid={`block-metric-row-${block.id}`}
      data-block-kind="metric_row"
      className="flex list-none flex-wrap gap-2 p-0"
    >
      {block.items.map((cell, index) => (
        <MetricChip key={`${block.id}-${index}`} blockId={block.id} index={index} cell={cell} />
      ))}
    </ul>
  )
}

type MetricChipProps = { blockId: string; index: number; cell: MetricCell }

function MetricChip({ blockId, index, cell }: MetricChipProps): ReactElement {
  return (
    <li
      data-testid={`block-metric-row-${blockId}-cell-${index}`}
      data-value-ref={cell.value_ref}
      data-delta-ref={cell.delta_ref}
      className="flex flex-col gap-0.5 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <span className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {cell.label}
      </span>
      <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {metricCellDisplayValue(cell)}
      </span>
      {metricCellHasDelta(cell) ? (
        <span
          className="text-xs text-neutral-500 dark:text-neutral-400"
          data-testid={`block-metric-row-${blockId}-cell-${index}-delta`}
        >
          Δ pending
        </span>
      ) : null}
    </li>
  )
}
