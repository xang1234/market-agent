import type { ReactElement } from 'react'
import type { PriceTargetRangeBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { LabelValueCell } from './LabelValueCell.tsx'

type PriceTargetField = 'current' | 'low' | 'avg' | 'high' | 'upside'

type PriceTargetRangeProps = { block: PriceTargetRangeBlock }

export function PriceTargetRange({ block }: PriceTargetRangeProps): ReactElement {
  return (
    <ChartCard
      testId={`block-price-target-range-${block.id}`}
      blockKind="price_target_range"
      title={block.title}
    >
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <PriceTargetCell blockId={block.id} field="current" label="Current" valueRef={block.current_price_ref} />
        <PriceTargetCell blockId={block.id} field="low" label="Low" valueRef={block.low_ref} />
        <PriceTargetCell blockId={block.id} field="avg" label="Avg" valueRef={block.avg_ref} />
        <PriceTargetCell blockId={block.id} field="high" label="High" valueRef={block.high_ref} />
        {block.upside_ref ? (
          <PriceTargetCell blockId={block.id} field="upside" label="Upside" valueRef={block.upside_ref} />
        ) : null}
      </dl>
    </ChartCard>
  )
}

type PriceTargetCellProps = {
  blockId: string
  field: PriceTargetField
  label: string
  valueRef: string
}

function PriceTargetCell({ blockId, field, label, valueRef }: PriceTargetCellProps): ReactElement {
  return (
    <LabelValueCell
      label={label}
      testId={`block-price-target-range-${blockId}-${field}`}
      dataAttrs={{ 'data-value-ref': valueRef }}
      emphasis
    >
      —
    </LabelValueCell>
  )
}
