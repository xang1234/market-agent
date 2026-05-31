import type { ReactElement } from 'react'
import type { MetricsComparisonBlock } from './types.ts'
import { formatSubjectRefShort } from './subjectRef.ts'

type MetricsComparisonProps = { block: MetricsComparisonBlock }

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
                className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted"
              >
                {metric}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.subjects.map((subject, rowIndex) => (
            <tr
              key={`${block.id}-row-${rowIndex}`}
              data-testid={`block-metrics-comparison-${block.id}-row-${rowIndex}`}
              data-subject-kind={subject.kind}
              data-subject-id={subject.id}
              className="border-t border-line"
            >
              <th scope="row" className="px-3 py-2 text-left text-fg">
                {formatSubjectRefShort(subject)}
              </th>
              {block.metrics.map((_metric, cellIndex) => (
                <td
                  key={`${block.id}-row-${rowIndex}-cell-${cellIndex}`}
                  className="px-3 py-2 tabular-nums text-muted"
                >
                  —
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
