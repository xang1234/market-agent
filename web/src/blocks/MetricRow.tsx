import type { ReactElement } from 'react'
import { InspectableRef } from '../evidence/InspectableRef.tsx'
import { extractInspectableRefs, type InspectableBlockRef } from '../evidence/inspectableRefs.ts'
import type { EvidenceInspectionRef } from '../evidence/inspectionTypes.ts'
import type { MetricCell, MetricRowBlock } from './types.ts'
import { metricCellDisplayValue, metricCellHasDelta } from './metricRow.ts'
import { INSET_SURFACE_CLASS } from '../symbol/surfaceStyles.ts'

type MetricRowProps = { block: MetricRowBlock }

export function MetricRow({ block }: MetricRowProps): ReactElement {
  const inspectableRefs = extractInspectableRefs(block)
  return (
    <ul
      data-testid={`block-metric-row-${block.id}`}
      data-block-kind="metric_row"
      className="flex list-none flex-wrap gap-2 p-0"
    >
      {block.items.map((cell, index) => (
        <MetricChip
          key={`${block.id}-${index}`}
          snapshotId={block.snapshot_id}
          valueRef={findInspectableRef(inspectableRefs, 'fact', cell.value_ref)}
          blockId={block.id}
          index={index}
          cell={cell}
        />
      ))}
    </ul>
  )
}

type MetricChipProps = {
  snapshotId: string
  valueRef: EvidenceInspectionRef
  blockId: string
  index: number
  cell: MetricCell
}

function MetricChip({ snapshotId, valueRef, blockId, index, cell }: MetricChipProps): ReactElement {
  return (
    <li
      data-testid={`block-metric-row-${blockId}-cell-${index}`}
      data-value-ref={cell.value_ref}
      data-delta-ref={cell.delta_ref}
      className={`flex flex-col gap-0.5 ${INSET_SURFACE_CLASS} px-3 py-2`}
    >
      <span className="text-xs uppercase tracking-wide text-muted">
        {cell.label}
      </span>
      <InspectableRef
        snapshotId={snapshotId}
        inspectionRef={valueRef}
        className="num text-left text-sm font-medium text-fg underline decoration-dotted underline-offset-2"
      >
        {metricCellDisplayValue(cell)}
      </InspectableRef>
      {metricCellHasDelta(cell) ? (
        <span
          className="text-xs text-muted"
          data-testid={`block-metric-row-${blockId}-cell-${index}-delta`}
        >
          Δ pending
        </span>
      ) : null}
    </li>
  )
}

function findInspectableRef(
  refs: ReadonlyArray<InspectableBlockRef>,
  kind: EvidenceInspectionRef['kind'],
  id: string,
): EvidenceInspectionRef {
  return refs.find((candidate) => candidate.ref.kind === kind && candidate.ref.id === id)?.ref ?? { kind, id }
}
