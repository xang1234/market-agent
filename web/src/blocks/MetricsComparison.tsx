import type { ReactElement } from 'react'
import type { MetricsComparisonBlock } from './types.ts'
import { formatSubjectRefShort } from './subjectRef.ts'

type MetricsComparisonProps = { block: MetricsComparisonBlock }

export function MetricsComparison({ block }: MetricsComparisonProps): ReactElement {
  return (
    <figure
      data-testid={`block-metrics-comparison-${block.id}`}
      data-block-kind="metrics_comparison"
      className="overflow-x-auto rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
    >
      {block.title ? (
        <figcaption className="border-b border-neutral-200 p-3 text-sm font-medium text-neutral-700 dark:border-neutral-800 dark:text-neutral-200">
          {block.title}
        </figcaption>
      ) : null}
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-neutral-50 dark:bg-neutral-900">
          <tr>
            <th
              scope="col"
              className="border-b border-neutral-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
            >
              Subject
            </th>
            {block.metrics.map((metric, index) => (
              <th
                key={`${block.id}-metric-${index}`}
                scope="col"
                className="border-b border-neutral-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
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
              className="border-t border-neutral-100 dark:border-neutral-800"
            >
              <th
                scope="row"
                className="px-3 py-2 text-left text-neutral-800 dark:text-neutral-200"
              >
                {formatSubjectRefShort(subject)}
              </th>
              {block.metrics.map((_metric, cellIndex) => (
                <td
                  key={`${block.id}-row-${rowIndex}-cell-${cellIndex}`}
                  className="px-3 py-2 text-neutral-500 dark:text-neutral-400"
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
