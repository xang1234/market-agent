import type { ReactElement } from 'react'
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
          <SourceRow key={`${block.id}-source-${index}`} blockId={block.id} index={index} item={item} />
        ))}
      </ol>
    </ChartCard>
  )
}

type SourceRowProps = { blockId: string; index: number; item: SourceItem }

function SourceRow({ blockId, index, item }: SourceRowProps): ReactElement {
  return (
    <li
      data-testid={`block-sources-${blockId}-source-${index}`}
      data-source-id={item.source_id}
      className="text-neutral-800 dark:text-neutral-200"
    >
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-neutral-300 hover:decoration-neutral-500 dark:decoration-neutral-600"
        >
          {item.label}
        </a>
      ) : (
        item.label
      )}
    </li>
  )
}
