import type { ReactElement } from 'react'
import type { NewsClusterBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { pluralize } from '../format/pluralize.ts'

type NewsClusterProps = { block: NewsClusterBlock }

export function NewsCluster({ block }: NewsClusterProps): ReactElement {
  const claimCount = block.claim_refs.length
  const documentCount = block.document_refs?.length ?? 0
  return (
    <ChartCard
      testId={`block-news-cluster-${block.id}`}
      blockKind="news_cluster"
      title={block.title}
      dataAttrs={{ 'data-cluster-id': block.cluster_id }}
    >
      <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
        {block.headline}
      </p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        <span data-testid={`block-news-cluster-${block.id}-claim-count`}>
          {claimCount} {pluralize(claimCount, 'claim')}
        </span>
        {documentCount > 0 ? (
          <>
            {' · '}
            <span data-testid={`block-news-cluster-${block.id}-document-count`}>
              {documentCount} {pluralize(documentCount, 'document')}
            </span>
          </>
        ) : null}
      </p>
    </ChartCard>
  )
}
