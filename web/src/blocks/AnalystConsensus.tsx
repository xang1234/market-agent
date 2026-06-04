import type { ReactElement } from 'react'
import type { AnalystConsensusBlock, AnalystDistributionBucket } from './types.ts'
import { ChartCard } from './ChartCard.tsx'

type AnalystConsensusProps = { block: AnalystConsensusBlock }

// Bucket colors by fixed rating order (strong_buy → strong_sell), matching the
// Symbol Overview consensus palette.
const BUCKET_COLORS = [
  'bg-emerald-600 dark:bg-emerald-500',
  'bg-emerald-400 dark:bg-emerald-600',
  'bg-neutral-400 dark:bg-neutral-500',
  'bg-red-400 dark:bg-red-600',
  'bg-red-600 dark:bg-red-500',
]

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
          <div
            role="img"
            aria-label={`Analyst ratings across ${total} contributors`}
            className="flex h-3 w-full overflow-hidden rounded"
          >
            {block.distribution.map((bucket, index) => {
              const count = bucket.count ?? 0
              if (count === 0) return null
              return (
                <div
                  key={`${block.id}-seg-${index}`}
                  data-testid={`block-analyst-consensus-${block.id}-rating-segment-${index}`}
                  className={BUCKET_COLORS[index] ?? 'bg-neutral-400'}
                  style={{ width: `${(count / total) * 100}%` }}
                  title={`${bucket.bucket}: ${count}`}
                />
              )
            })}
          </div>
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
