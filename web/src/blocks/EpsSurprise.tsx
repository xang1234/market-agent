import type { ReactElement } from 'react'
import type { EpsSurpriseBlock, EpsSurpriseQuarter } from './types.ts'
import { ChartCard } from './ChartCard.tsx'

type EpsSurpriseProps = { block: EpsSurpriseBlock }

export function EpsSurprise({ block }: EpsSurpriseProps): ReactElement {
  return (
    <ChartCard
      testId={`block-eps-surprise-${block.id}`}
      blockKind="eps_surprise"
      title={block.title}
    >
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            <th scope="col" className="py-1 font-medium">Quarter</th>
            <th scope="col" className="py-1 font-medium">Estimate</th>
            <th scope="col" className="py-1 font-medium">Actual</th>
            <th scope="col" className="py-1 font-medium">Surprise</th>
          </tr>
        </thead>
        <tbody>
          {block.quarters.map((quarter, index) => (
            <QuarterRow
              key={`${block.id}-quarter-${index}`}
              blockId={block.id}
              index={index}
              quarter={quarter}
            />
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}

type QuarterRowProps = {
  blockId: string
  index: number
  quarter: EpsSurpriseQuarter
}

function QuarterRow({ blockId, index, quarter }: QuarterRowProps): ReactElement {
  return (
    <tr
      data-testid={`block-eps-surprise-${blockId}-quarter-${index}`}
      data-estimate-ref={quarter.estimate_ref}
      data-actual-ref={quarter.actual_ref}
      data-surprise-ref={quarter.surprise_ref}
      className="border-t border-neutral-100 dark:border-neutral-800"
    >
      <th scope="row" className="py-1 text-left font-medium text-neutral-800 dark:text-neutral-200">
        {quarter.label}
      </th>
      <td className="py-1 text-neutral-500 dark:text-neutral-400">—</td>
      <td className="py-1 text-neutral-500 dark:text-neutral-400">—</td>
      <td className="py-1 text-neutral-500 dark:text-neutral-400">
        {quarter.surprise_ref ? '—' : null}
      </td>
    </tr>
  )
}
