import type { ReactElement } from 'react'
import type { FindingCardBlock } from './types.ts'
import { Badge } from './Badge.tsx'
import { ChartCard } from './ChartCard.tsx'
import { SubjectChipList } from './SubjectChipList.tsx'
import { findingSeverityBadgeClass } from './findingCard.ts'

type FindingCardProps = { block: FindingCardBlock }

export function FindingCard({ block }: FindingCardProps): ReactElement {
  return (
    <ChartCard
      testId={`block-finding-card-${block.id}`}
      blockKind="finding_card"
      title={block.title}
      dataAttrs={{
        'data-finding-id': block.finding_id,
        'data-severity': block.severity,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
          {block.headline}
        </p>
        <Badge
          testId={`block-finding-card-${block.id}-severity`}
          toneClass={findingSeverityBadgeClass(block.severity)}
          layoutClass="shrink-0"
        >
          {block.severity[0].toUpperCase() + block.severity.slice(1)}
        </Badge>
      </div>
      {block.subject_refs && block.subject_refs.length > 0 ? (
        <SubjectChipList
          testId={`block-finding-card-${block.id}-subjects`}
          keyPrefix={`${block.id}-subj`}
          subjects={block.subject_refs}
          dense
        />
      ) : null}
    </ChartCard>
  )
}
