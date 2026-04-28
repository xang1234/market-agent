import type { ReactElement } from 'react'
import type { PerfComparisonBlock, SubjectRef } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { perfNormalizationLabel } from './perfComparison.ts'
import { formatSubjectRefShort } from './subjectRef.ts'

type PerfComparisonProps = { block: PerfComparisonBlock }

export function PerfComparison({ block }: PerfComparisonProps): ReactElement {
  return (
    <ChartCard
      testId={`block-perf-comparison-${block.id}`}
      blockKind="perf_comparison"
      title={block.title}
      dataAttrs={{
        'data-default-range': block.default_range,
        'data-basis': block.basis,
        'data-normalization': block.normalization,
      }}
    >
      <SubjectList blockId={block.id} subjects={block.subject_refs} />
      <dl className="grid grid-cols-3 gap-2 text-xs text-neutral-600 dark:text-neutral-400">
        <PerfMeta label="Range" value={block.default_range} />
        <PerfMeta label="Basis" value={block.basis} />
        <PerfMeta label="Normalization" value={perfNormalizationLabel(block.normalization)} />
      </dl>
    </ChartCard>
  )
}

type SubjectListProps = { blockId: string; subjects: ReadonlyArray<SubjectRef> }

function SubjectList({ blockId, subjects }: SubjectListProps): ReactElement {
  return (
    <ul
      data-testid={`block-perf-comparison-${blockId}-subjects`}
      className="flex list-none flex-wrap gap-2 p-0 text-xs"
    >
      {subjects.map((subject, index) => (
        <li
          key={`${blockId}-subj-${index}`}
          data-subject-kind={subject.kind}
          data-subject-id={subject.id}
          className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        >
          {formatSubjectRefShort(subject)}
        </li>
      ))}
    </ul>
  )
}

type PerfMetaProps = { label: string; value: string }

function PerfMeta({ label, value }: PerfMetaProps): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="text-neutral-800 dark:text-neutral-200">{value}</dd>
    </div>
  )
}
