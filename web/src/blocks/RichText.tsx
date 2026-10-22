import type { ReactElement } from 'react'
import { InspectableRef } from '../evidence/InspectableRef.tsx'
import { InspectableResult } from './FinancialAnswer.tsx'
import type { RefSegment, RichTextBlock, TextSegmentTone } from './types.ts'
import { isRefSegment, refSegmentText } from './richText.ts'
import { Markdown } from './Markdown.tsx'

type RichTextProps = { block: RichTextBlock }

// Inline emphasis for toned text runs (the video's green "+127% YoY" deltas).
// Neutral tone is intentionally unstyled: it exists so emitters can be
// explicit without changing rendering.
const TONE_CLASS: Readonly<Record<Exclude<TextSegmentTone, 'neutral'>, string>> = {
  positive: 'font-medium text-positive',
  negative: 'font-medium text-negative',
}

// The block is one Markdown document. Plain text runs are Markdown source,
// concatenated verbatim; refs and toned runs are embedded inline, so a ref's
// format and a toned delta render literally wherever the Markdown puts them.
export function RichText({ block }: RichTextProps): ReactElement {
  const parts = block.segments.map((segment, index) => {
    if (isRefSegment(segment)) {
      if (segment.ref_kind === 'result') {
        const shown = refSegmentText(segment)
        return (
          <InspectableResult resultId={segment.ref_id} label={segment.period ? `${shown}, ${segment.period}` : shown}>
            {shown}
          </InspectableResult>
        )
      }
      return (
        <RefSegmentSpan
          snapshotId={block.snapshot_id}
          blockId={block.id}
          index={index}
          segment={segment}
        />
      )
    }
    if (segment.tone === undefined || segment.tone === 'neutral') return segment.text
    return { inline: <span data-tone={segment.tone} className={TONE_CLASS[segment.tone]}>{segment.text}</span> }
  })
  return (
    <div
      data-testid={`block-rich-text-${block.id}`}
      data-block-kind="rich_text"
      className="text-sm leading-6 text-fg-soft"
    >
      {/* Its figures are the answer's; its words are not verified. */}
      {block.analyst_commentary ? <p data-analyst-commentary className="text-xs font-medium text-muted">Analyst commentary</p> : null}
      <Markdown text={parts} />
    </div>
  )
}

type RefSegmentSpanProps = {
  snapshotId: string
  blockId: string
  index: number
  segment: Exclude<RefSegment, { ref_kind: 'result' }>
}

// A value as the text reads it, with no padding or fill: either would show as a
// space before the punctuation after it (#303).
const REF_CLASS = 'rounded text-fg-soft underline decoration-dotted underline-offset-2'

function RefSegmentSpan({ snapshotId, blockId, index, segment }: RefSegmentSpanProps): ReactElement {
  return (
    <InspectableRef
      snapshotId={snapshotId}
      inspectionRef={{ kind: segment.ref_kind, id: segment.ref_id }}
      // Other kinds keep the server title, which says more than their prose text.
      shownAs={segment.ref_kind === 'fact' ? segment.format || undefined : undefined}
      testId={`block-rich-text-${blockId}-ref-${index}`}
      dataAttrs={{ 'data-ref-kind': segment.ref_kind, 'data-ref-id': segment.ref_id }}
      className={REF_CLASS}
    >
      {refSegmentText(segment)}
    </InspectableRef>
  )
}
