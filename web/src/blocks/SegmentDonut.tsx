import type { ReactElement } from 'react'
import type { DonutSegment, SegmentDonutBlock } from './types.ts'
import { ChartCard } from './ChartCard.tsx'

type SegmentDonutProps = { block: SegmentDonutBlock }

export function SegmentDonut({ block }: SegmentDonutProps): ReactElement {
  return (
    <ChartCard
      testId={`block-segment-donut-${block.id}`}
      blockKind="segment_donut"
      title={block.title}
    >
      <ul className="flex list-none flex-col gap-1 p-0 text-sm">
        {block.segments.map((segment, index) => (
          <SegmentRow
            key={`${block.id}-seg-${index}`}
            blockId={block.id}
            index={index}
            segment={segment}
          />
        ))}
      </ul>
      {block.coverage_warnings && block.coverage_warnings.length > 0 ? (
        <CoverageWarnings blockId={block.id} warnings={block.coverage_warnings} />
      ) : null}
    </ChartCard>
  )
}

type SegmentRowProps = { blockId: string; index: number; segment: DonutSegment }

function SegmentRow({ blockId, index, segment }: SegmentRowProps): ReactElement {
  return (
    <li
      data-testid={`block-segment-donut-${blockId}-segment-${index}`}
      data-value-ref={segment.value_ref}
      className="flex items-center justify-between gap-3"
    >
      <span className="text-neutral-800 dark:text-neutral-200">{segment.name}</span>
      {segment.definition_as_of ? (
        <time
          dateTime={segment.definition_as_of}
          className="text-xs text-neutral-500 dark:text-neutral-400"
        >
          as of {segment.definition_as_of}
        </time>
      ) : null}
    </li>
  )
}

type CoverageWarningsProps = { blockId: string; warnings: ReadonlyArray<string> }

function CoverageWarnings({ blockId, warnings }: CoverageWarningsProps): ReactElement {
  return (
    <ul
      data-testid={`block-segment-donut-${blockId}-coverage`}
      role="alert"
      className="flex list-none flex-col gap-0.5 p-0 text-xs text-amber-700 dark:text-amber-400"
    >
      {warnings.map((warning, index) => (
        <li key={`${blockId}-warning-${index}`}>{warning}</li>
      ))}
    </ul>
  )
}
