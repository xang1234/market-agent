import type { ReactElement } from 'react'
import type { FilingItem, FilingsListBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { formatIsoTimestamp } from '../symbol/format.ts'

type FilingsListProps = { block: FilingsListBlock }

export function FilingsList({ block }: FilingsListProps): ReactElement {
  return (
    <ChartCard
      testId={`block-filings-list-${block.id}`}
      blockKind="filings_list"
      title={block.title}
    >
      <ul className="flex list-none flex-col gap-1 p-0 text-sm">
        {block.items.map((item, index) => (
          <FilingRow key={`${block.id}-filing-${index}`} blockId={block.id} index={index} item={item} />
        ))}
      </ul>
    </ChartCard>
  )
}

type FilingRowProps = { blockId: string; index: number; item: FilingItem }

function FilingRow({ blockId, index, item }: FilingRowProps): ReactElement {
  return (
    <li
      data-testid={`block-filings-list-${blockId}-filing-${index}`}
      data-document-id={item.document_id}
      className="flex items-baseline justify-between gap-3"
    >
      <span className="font-medium text-neutral-800 dark:text-neutral-200">{item.form}</span>
      <span className="flex items-baseline gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        {item.period ? <span>{item.period}</span> : null}
        <time dateTime={item.filed_at}>{formatIsoTimestamp(item.filed_at)}</time>
      </span>
    </li>
  )
}
