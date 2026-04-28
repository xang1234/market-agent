import type { ReactElement } from 'react'
import type { AnalystConsensusBlock, AnalystDistributionBucket } from './types.ts'
import { ChartCard } from './ChartCard.tsx'

type AnalystConsensusProps = { block: AnalystConsensusBlock }

export function AnalystConsensus({ block }: AnalystConsensusProps): ReactElement {
  return (
    <ChartCard
      testId={`block-analyst-consensus-${block.id}`}
      blockKind="analyst_consensus"
      title={block.title}
      dataAttrs={{ 'data-analyst-count-ref': block.analyst_count_ref }}
    >
      <ul className="flex list-none flex-col gap-1 p-0 text-sm">
        {block.distribution.map((bucket, index) => (
          <DistributionRow
            key={`${block.id}-bucket-${index}`}
            blockId={block.id}
            index={index}
            bucket={bucket}
          />
        ))}
      </ul>
      {block.coverage_warning ? (
        <p
          data-testid={`block-analyst-consensus-${block.id}-coverage`}
          role="alert"
          className="text-xs text-amber-700 dark:text-amber-400"
        >
          {block.coverage_warning}
        </p>
      ) : null}
    </ChartCard>
  )
}

type DistributionRowProps = {
  blockId: string
  index: number
  bucket: AnalystDistributionBucket
}

function DistributionRow({ blockId, index, bucket }: DistributionRowProps): ReactElement {
  return (
    <li
      data-testid={`block-analyst-consensus-${blockId}-bucket-${index}`}
      data-count-ref={bucket.count_ref}
      className="flex items-center justify-between gap-3"
    >
      <span className="text-neutral-800 dark:text-neutral-200">{bucket.bucket}</span>
      <span className="text-xs text-neutral-500 dark:text-neutral-400">—</span>
    </li>
  )
}
