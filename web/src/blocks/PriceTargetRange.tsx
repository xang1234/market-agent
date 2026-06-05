import type { ReactElement } from 'react'
import type { PriceTargetRangeBlock, PriceTargetRangeDisplay } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { LabelValueCell } from './LabelValueCell.tsx'

type PriceTargetRangeProps = { block: PriceTargetRangeBlock }

export function PriceTargetRange({ block }: PriceTargetRangeProps): ReactElement {
  return (
    <ChartCard testId={`block-price-target-range-${block.id}`} blockKind="price_target_range" title={block.title}>
      {block.display ? (
        <RangeBar blockId={block.id} display={block.display} />
      ) : (
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <StubCell blockId={block.id} field="current" label="Current" valueRef={block.current_price_ref} />
          <StubCell blockId={block.id} field="low" label="Low" valueRef={block.low_ref} />
          <StubCell blockId={block.id} field="avg" label="Avg" valueRef={block.avg_ref} />
          <StubCell blockId={block.id} field="high" label="High" valueRef={block.high_ref} />
        </dl>
      )}
    </ChartCard>
  )
}

function RangeBar({ blockId, display }: { blockId: string; display: PriceTargetRangeDisplay }): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
        <PriceRow label="Low" value={display.low.format} />
        <PriceRow label="Avg" value={display.avg.format} emphasis />
        <PriceRow label="High" value={display.high.format} />
        <PriceRow label="Current" value={display.current.format} />
      </dl>
      <div className="relative h-2 rounded bg-surface-2">
        <span
          aria-hidden="true"
          data-testid={`block-price-target-range-${blockId}-avg-marker`}
          className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-accent"
          style={{ left: `${display.avg.position * 100}%` }}
        />
        <span
          aria-hidden="true"
          data-testid={`block-price-target-range-${blockId}-current-marker`}
          className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-fg"
          style={{ left: `${display.current.position * 100}%` }}
        />
      </div>
    </div>
  )
}

function PriceRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={emphasis ? 'num font-medium text-fg' : 'num text-fg'}>{value}</dd>
    </div>
  )
}

function StubCell({ blockId, field, label, valueRef }: { blockId: string; field: string; label: string; valueRef: string }): ReactElement {
  return (
    <LabelValueCell label={label} testId={`block-price-target-range-${blockId}-${field}`} dataAttrs={{ 'data-value-ref': valueRef }} emphasis>
      —
    </LabelValueCell>
  )
}
