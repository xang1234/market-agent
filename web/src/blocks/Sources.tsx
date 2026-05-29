import type { ReactElement } from 'react'
import { InspectableRef } from '../evidence/InspectableRef.tsx'
import type { SourceItem, SourcesBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'

type SourcesProps = { block: SourcesBlock }

export function Sources({ block }: SourcesProps): ReactElement {
  return (
    <ChartCard
      testId={`block-sources-${block.id}`}
      blockKind="sources"
      title={block.title}
    >
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
        {block.items.map((item, index) => (
          <SourceRow
            key={`${block.id}-source-${index}`}
            snapshotId={block.snapshot_id}
            blockId={block.id}
            index={index}
            item={item}
          />
        ))}
      </ol>
    </ChartCard>
  )
}

type SourceRowProps = { snapshotId: string; blockId: string; index: number; item: SourceItem }

function SourceRow({ snapshotId, blockId, index, item }: SourceRowProps): ReactElement {
  return (
    <li
      data-testid={`block-sources-${blockId}-source-${index}`}
      data-source-id={item.source_id}
      className="text-neutral-800 dark:text-neutral-200"
    >
      <InspectableRef
        snapshotId={snapshotId}
        inspectionRef={{ kind: 'source', id: item.source_id }}
        className="text-left underline decoration-neutral-300 hover:decoration-neutral-500 dark:decoration-neutral-600"
      >
        {item.label}
      </InspectableRef>
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-2 text-xs text-neutral-500 underline decoration-neutral-300 hover:text-neutral-700 hover:decoration-neutral-500 dark:text-neutral-400 dark:decoration-neutral-600 dark:hover:text-neutral-200"
        >
          Open
        </a>
      ) : null}
    </li>
  )
}
