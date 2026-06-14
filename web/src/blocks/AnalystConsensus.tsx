import type { ReactElement } from 'react'
import type { AnalystConsensusBlock, AnalystDistributionBucket } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { ANALYST_RATINGS, RATING_BAR_COLORS } from '../symbol/consensus.ts'
import { StackedBar } from '../symbol/StackedBar.tsx'

type AnalystConsensusProps = { block: AnalystConsensusBlock }

export function AnalystConsensus({ block }: AnalystConsensusProps): ReactElement {
  const counts = block.distribution.map((bucket) => bucket.count)
  const hasCounts = counts.every((count) => typeof count === 'number')
  const total = hasCounts ? counts.reduce((sum, count) => sum + (count as number), 0) : 0

  return (
    <ChartCard
      testId={`block-analyst-consensus-${block.id}`}
      blockKind="analyst_consensus"
      title={block.title}
      dataAttrs={{ 'data-analyst-count-ref': block.analyst_count_ref }}
    >
      {hasCounts && total > 0 ? (
        <div className="flex flex-col gap-2">
          <StackedBar
            ariaLabel={`Analyst ratings across ${total} contributors`}
            heightClass="h-3"
            segments={block.distribution.map((bucket, index) => ({
              key: `${block.id}-seg-${index}`,
              value: bucket.count ?? 0,
              label: bucket.bucket,
              className: RATING_BAR_COLORS[ANALYST_RATINGS[index]] ?? 'bg-neutral-400',
              testId: `block-analyst-consensus-${block.id}-rating-segment-${index}`,
              title: `${bucket.bucket}: ${bucket.count ?? 0}`,
            }))}
          />
          <ul className="flex list-none flex-col gap-1 p-0 text-sm">
            {block.distribution.map((bucket, index) => (
              <li
                key={`${block.id}-bucket-${index}`}
                data-testid={`block-analyst-consensus-${block.id}-bucket-${index}`}
                data-count-ref={bucket.count_ref}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-fg">{bucket.bucket}</span>
                <span className="num text-xs text-muted">{bucket.count}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{total} ratings</p>
        </div>
      ) : (
        <ul className="flex list-none flex-col gap-1 p-0 text-sm">
          {block.distribution.map((bucket, index) => (
            <StubRow key={`${block.id}-bucket-${index}`} blockId={block.id} index={index} bucket={bucket} />
          ))}
        </ul>
      )}
      {block.coverage_warning ? (
        <p
          data-testid={`block-analyst-consensus-${block.id}-coverage`}
          role="alert"
          className="text-xs text-warning"
        >
          {block.coverage_warning}
        </p>
      ) : null}
    </ChartCard>
  )
}

function StubRow({
  blockId,
  index,
  bucket,
}: {
  blockId: string
  index: number
  bucket: AnalystDistributionBucket
}): ReactElement {
  return (
    <li
      data-testid={`block-analyst-consensus-${blockId}-bucket-${index}`}
      data-count-ref={bucket.count_ref}
      className="flex items-center justify-between gap-3"
    >
      <span className="text-fg">{bucket.bucket}</span>
      <span className="num text-xs text-muted">—</span>
    </li>
  )
}
