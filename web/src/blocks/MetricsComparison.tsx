import type { ReactElement } from 'react'
import type { MetricsComparisonBlock, MetricsComparisonCell, SubjectRef } from './types.ts'
import { formatSubjectRefShort } from './subjectRef.ts'
import { NEGATIVE_CLASS, POSITIVE_CLASS } from '../symbol/signedColor.ts'
import { CARD_CLASS } from '../symbol/surfaceStyles.ts'
import { InspectableRef } from '../evidence/InspectableRef.tsx'

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
      className={`overflow-x-auto ${CARD_CLASS}`}
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
                    snapshotId={block.snapshot_id}
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

// A present cell's value links to its backing fact via InspectableRef (the
// emitter now seals these facts, so the inspector resolves). A null/absent cell
// is a gap and renders a plain em-dash.
function ComparisonCell({
  cell,
  snapshotId,
}: {
  cell: MetricsComparisonCell | null | undefined
  snapshotId: string
}): ReactElement {
  // null = an explicit gap (subject lacks this metric); undefined = no cells
  // matrix / short row. Both render as an em-dash.
  if (cell == null) {
    return <td className="num px-3 py-2 text-right text-muted">—</td>
  }
  const toneClass = cell.tone ? TONE_CLASS[cell.tone] : 'text-fg'
  return (
    <td className={`num px-3 py-2 text-right ${toneClass}`}>
      <InspectableRef
        snapshotId={snapshotId}
        inspectionRef={{ kind: 'fact', id: cell.value_ref }}
        className="underline decoration-dotted underline-offset-2"
      >
        {cell.format ?? '—'}
      </InspectableRef>
    </td>
  )
}
