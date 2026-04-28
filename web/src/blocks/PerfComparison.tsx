import type { ReactElement } from 'react'
import type { PerfComparisonBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'
import { LabelValueCell } from './LabelValueCell.tsx'
import { SubjectChipList } from './SubjectChipList.tsx'
import { perfNormalizationLabel } from './perfComparison.ts'

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
      <SubjectChipList
        testId={`block-perf-comparison-${block.id}-subjects`}
        keyPrefix={`${block.id}-subj`}
        subjects={block.subject_refs}
      />
      <dl className="grid grid-cols-3 gap-2 text-xs text-neutral-600 dark:text-neutral-400">
        <LabelValueCell label="Range">{block.default_range}</LabelValueCell>
        <LabelValueCell label="Basis">{block.basis}</LabelValueCell>
        <LabelValueCell label="Normalization">{perfNormalizationLabel(block.normalization)}</LabelValueCell>
      </dl>
    </ChartCard>
  )
}
