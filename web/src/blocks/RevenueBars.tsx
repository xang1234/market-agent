import type { ReactElement } from 'react'
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
          <RevenueBarColumn key={`${block.id}-bar-${index}`} blockId={block.id} index={index} bar={bar} />
        ))}
      </div>
    </ChartCard>
  )
}

type RevenueBarColumnProps = { blockId: string; index: number; bar: RevenueBar }

function RevenueBarColumn({ blockId, index, bar }: RevenueBarColumnProps): ReactElement {
  return (
    <div
      data-testid={`block-revenue-bars-${blockId}-bar-${index}`}
      data-value-ref={bar.value_ref}
      data-delta-ref={bar.delta_ref}
      className="flex flex-1 flex-col items-center justify-end gap-1"
    >
      <div
        aria-hidden
        className="w-full rounded-sm bg-blue-200 dark:bg-blue-800"
        // Equal-height placeholder bars until the value resolver fills in
        // real heights from the value_ref UUIDs.
        style={{ height: '60%' }}
      />
      <span className="text-xs text-neutral-600 dark:text-neutral-400">{bar.label}</span>
    </div>
  )
}
