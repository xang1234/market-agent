import type { ReactElement } from 'react'
import { InspectableRef } from '../evidence/InspectableRef.tsx'
import type { RevenueBar, RevenueBarsBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'

type RevenueBarsProps = { block: RevenueBarsBlock }

export function RevenueBars({ block }: RevenueBarsProps): ReactElement {
  return (
    <ChartCard
      testId={`block-revenue-bars-${block.id}`}
      blockKind="revenue_bars"
      title={block.title}
    >
      <div className="flex h-32 items-end gap-2">
        {block.bars.map((bar, index) => (
          <RevenueBarColumn
            key={`${block.id}-bar-${index}`}
            blockId={block.id}
            snapshotId={block.snapshot_id}
            index={index}
            bar={bar}
          />
        ))}
      </div>
    </ChartCard>
  )
}

type RevenueBarColumnProps = { blockId: string; snapshotId: string; index: number; bar: RevenueBar }

function RevenueBarColumn({ blockId, snapshotId, index, bar }: RevenueBarColumnProps): ReactElement {
  // Pre-computed magnitude (0..1, peak bar = 1) drives the height; absent ->
  // the equal-height stub. The format string is the rendered value label.
  const heightPct = bar.magnitude == null ? 60 : Math.max(0, Math.min(1, bar.magnitude)) * 100
  return (
    <div
      data-testid={`block-revenue-bars-${blockId}-bar-${index}`}
      data-value-ref={bar.value_ref}
      data-delta-ref={bar.delta_ref}
      className="flex flex-1 flex-col items-center justify-end gap-1"
    >
      <div
        aria-hidden
        className="w-full rounded-sm bg-accent-soft"
        style={{ height: `${heightPct}%` }}
      />
      {/* The value opens its backing fact in the evidence inspector. */}
      <InspectableRef
        snapshotId={snapshotId}
        inspectionRef={{ kind: 'fact', id: bar.value_ref }}
        className="num text-xs text-fg underline decoration-dotted underline-offset-2"
      >
        {bar.format ?? '—'}
      </InspectableRef>
      <span className="text-xs text-muted">{bar.label}</span>
    </div>
  )
}
