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
      className="text-fg"
    >
      <InspectableRef
        snapshotId={snapshotId}
        inspectionRef={{ kind: 'source', id: item.source_id }}
        className="text-left underline decoration-line-strong hover:decoration-muted"
      >
        {item.label}
      </InspectableRef>
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-2 text-xs text-muted underline decoration-line-strong hover:text-fg hover:decoration-muted"
        >
          Open
        </a>
      ) : null}
    </li>
  )
}
