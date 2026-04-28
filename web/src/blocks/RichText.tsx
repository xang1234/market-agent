import type { ReactElement } from 'react'
import type { RichTextBlock } from './types.ts'
import { isRefSegment, refSegmentPlaceholder } from './richText.ts'

type RichTextProps = { block: RichTextBlock }

export function RichText({ block }: RichTextProps): ReactElement {
  return (
    <p
      data-testid={`block-rich-text-${block.id}`}
      data-block-kind="rich_text"
      className="text-sm leading-6 text-neutral-800 dark:text-neutral-200"
    >
      {block.segments.map((segment, index) => {
        if (isRefSegment(segment)) {
          return (
            <span
              key={`${block.id}-seg-${index}`}
              data-testid={`block-rich-text-${block.id}-ref-${index}`}
              data-ref-kind={segment.ref_kind}
              data-ref-id={segment.ref_id}
              className="rounded bg-neutral-100 px-1 text-neutral-700 underline decoration-dotted dark:bg-neutral-800 dark:text-neutral-200"
            >
              {refSegmentPlaceholder(segment)}
            </span>
          )
        }
        return <span key={`${block.id}-seg-${index}`}>{segment.text}</span>
      })}
    </p>
  )
}
