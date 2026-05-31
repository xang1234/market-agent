import type { ReactElement } from 'react'
import type { MetricsComparisonBlock, MetricsComparisonCell, SubjectRef } from './types.ts'
import { formatSubjectRefShort } from './subjectRef.ts'
import { NEGATIVE_CLASS, POSITIVE_CLASS } from '../symbol/signedColor.ts'

type MetricsComparisonProps = { block: MetricsComparisonBlock }

const TONE_CLASS: Readonly<Record<NonNullable<MetricsComparisonCell['tone']>, string>> = {
  positive: POSITIVE_CLASS,
  negative: NEGATIVE_CLASS,
  neutral: 'text-fg',
}

const subjectMatches = (a: SubjectRef | undefined, b: SubjectRef): boolean =>
  a !== undefined && a.kind === b.kind && a.id === b.id

export function MetricsComparison({ block }: MetricsComparisonProps): ReactElement {
  return (
    <figure
      data-testid={`block-metrics-comparison-${block.id}`}
      data-block-kind="metrics_comparison"
      className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm"
    >
      {block.title ? (
        <figcaption className="border-b border-line p-3 text-sm font-medium text-fg">
          {block.title}
        </figcaption>
      ) : null}
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-surface-2">
          <tr>
            <th
              scope="col"
              className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted"
            >
              Subject
            </th>
            {block.metrics.map((metric, index) => (
              <th
                key={`${block.id}-metric-${index}`}
                scope="col"
                className="border-b border-line px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted"
              >
                {metric}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.subjects.map((subject, rowIndex) => {
            const isPrimary = subjectMatches(block.primary_subject_ref, subject)
            return (
              <tr
                key={`${block.id}-row-${rowIndex}`}
                data-testid={`block-metrics-comparison-${block.id}-row-${rowIndex}`}
                data-subject-kind={subject.kind}
                data-subject-id={subject.id}
                data-primary={isPrimary ? 'true' : undefined}
                className={`border-t border-line ${isPrimary ? 'bg-accent-soft' : ''}`}
              >
                <th
                  scope="row"
                  className={`px-3 py-2 text-left ${isPrimary ? 'font-semibold text-accent' : 'text-fg'}`}
                >
                  {formatSubjectRefShort(subject)}
                </th>
                {block.metrics.map((_metric, cellIndex) => (
                  <ComparisonCell
                    key={`${block.id}-row-${rowIndex}-cell-${cellIndex}`}
                    cell={block.cells?.[rowIndex]?.[cellIndex]}
                  />
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </figure>
  )
}

// Cells render plain (mono, tone-colored). The contract carries value_ref for
// evidence linkage, but per-cell inspection is deliberately deferred to the
// same milestone as the emitter — until real snapshots exist, a value_ref
// resolves to no fact, so wiring click-to-inspect now would open an empty
// inspector. See fra-0clw notes.
function ComparisonCell({ cell }: { cell: MetricsComparisonCell | undefined }): ReactElement {
  if (cell === undefined) {
    return <td className="num px-3 py-2 text-right text-muted">—</td>
  }
  const toneClass = cell.tone ? TONE_CLASS[cell.tone] : 'text-fg'
  return <td className={`num px-3 py-2 text-right ${toneClass}`}>{cell.format ?? '—'}</td>
}
