import type { ReactElement } from 'react'
import type { NewsClusterBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import {
  newsClusterEvidenceTarget,
  newsClusterSupportSummary,
} from './socialNewsBlocks.ts'

type NewsClusterProps = { block: NewsClusterBlock }

export function NewsCluster({ block }: NewsClusterProps): ReactElement {
  const summary = newsClusterSupportSummary(block)
  const evidenceTarget = newsClusterEvidenceTarget(block)
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
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span data-testid={`block-news-cluster-${block.id}-claim-count`}>
          {summary.supportLabel}
        </span>
        <button
          type="button"
          data-testid={`block-news-cluster-${block.id}-evidence`}
          data-evidence-bundle-cluster-id={evidenceTarget.clusterId}
          data-evidence-bundle-claim-ids={evidenceTarget.claimIds.join(',')}
          data-evidence-bundle-document-ids={evidenceTarget.documentIds.join(',')}
          className="rounded border border-neutral-300 px-2 py-1 font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          View evidence bundle
        </button>
      </div>
    </ChartCard>
  )
}
