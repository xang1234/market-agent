import { useContext, type ReactElement } from 'react'
import { InspectableRef } from '../evidence/InspectableRef.tsx'
import { InspectableResult } from '../evidence/InspectableResult.tsx'
import type { CommentaryPart, RefSegment, RichTextBlock, RichTextSegment, TextSegmentTone } from './types.ts'
import { isRefSegment, refSegmentText } from './richText.ts'
import { Markdown } from './Markdown.tsx'
import { OpenClarificationContext } from './openClarification.ts'
import { CARD_CLASS } from '../symbol/surfaceStyles.ts'
import { PILL_CLASS, VERIFICATION_CLASSES } from './verification.ts'

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
  if (block.commentary) return <Commentary block={block} parts={block.commentary} />
  return (
    <div
      data-testid={`block-rich-text-${block.id}`}
      data-block-kind="rich_text"
      className="text-sm leading-6 text-fg-soft"
    >
      {/* Its figures are the answer's; its words are not verified. */}
      {block.analyst_commentary ? <p data-analyst-commentary className="text-xs font-medium text-muted">Analyst commentary</p> : null}
      <Markdown text={markdownParts(block, block.segments)} />
      {block.clarification_choices ? <OfferedChoices blockId={block.id} choices={block.clarification_choices} /> : null}
    </div>
  )
}

// Segments as Markdown source, each ref an inspectable value. key keeps the
// refs of several runs in one block apart.
function markdownParts(block: RichTextBlock, segments: ReadonlyArray<RichTextSegment>, key = '') {
  return segments.map((segment, index) => {
    if (isRefSegment(segment)) {
      if (segment.ref_kind === 'result') {
        const shown = refSegmentText(segment)
        return (
          <InspectableResult
            resultId={segment.ref_id}
            label={segment.period ? `${shown}, ${segment.period}` : shown}
            shown={{ subject: null, measure: null, period: segment.period ?? null, value: shown }}
          >
            {shown}
          </InspectableResult>
        )
      }
      return (
        <RefSegmentSpan
          snapshotId={block.snapshot_id}
          blockId={block.id}
          index={`${key}${index}`}
          segment={segment}
        />
      )
    }
    if (segment.tone === undefined || segment.tone === 'neutral') return segment.text
    return { inline: <span data-tone={segment.tone} className={TONE_CLASS[segment.tone]}>{segment.text}</span> }
  })
}

type Takeaway = Extract<CommentaryPart, { kind: 'inference' | 'unverified' | 'pending' }>

// Each takeaway's badge: what the judge found of it.
const BADGES: Readonly<Record<Takeaway['kind'], { text: string; title: string; className: string }>> = {
  inference: { text: 'Inference', title: 'Checked against the figures shown', className: VERIFICATION_CLASSES.verified },
  unverified: { text: 'Unverified', title: 'Not backed by the figures shown', className: 'border-warning/40 bg-warning-soft text-warning' },
  pending: { text: 'Checking', title: 'Being checked against the figures shown', className: VERIFICATION_CLASSES.not_verified },
}

const isTakeaway = (part: CommentaryPart): part is Takeaway => part.kind in BADGES

// Commentary as a card continuing the answer above it: the analyst's
// takeaways first, each badged by its verdict, then the figures they rest
// on, then any note. Its words are plain text, as the analyst wrote them.
function Commentary({ block, parts }: { block: RichTextBlock; parts: ReadonlyArray<CommentaryPart> }): ReactElement {
  const takeaways = parts.filter(isTakeaway)
  const figures = parts.flatMap((part) => (part.kind === 'figures' ? [part] : []))
  const notes = parts.flatMap((part) => (part.kind === 'note' ? [part.text] : []))
  return (
    <section
      data-testid={`block-rich-text-${block.id}`}
      data-block-kind="rich_text"
      data-analyst-commentary
      aria-labelledby={`${block.id}-analysis`}
      className={`flex flex-col gap-3 ${CARD_CLASS} p-3 text-sm leading-6 text-fg-soft`}
    >
      <h3 id={`${block.id}-analysis`} className="text-sm font-semibold text-fg">Analysis</h3>
      {takeaways.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {takeaways.map((part, index) => <TakeawayItem key={index} part={part} />)}
        </ul>
      ) : null}
      {figures.length > 0 ? (
        <div>
          <h4 className="text-xs font-medium text-muted">Supporting figures</h4>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
            {figures.map((part, index) => <li key={index}><Markdown text={markdownParts(block, part.segments, `${index}-`)} /></li>)}
          </ul>
        </div>
      ) : null}
      {notes.length > 0 ? <p className="text-xs text-muted">{notes.join(' ')}</p> : null}
    </section>
  )
}

function TakeawayItem({ part }: { part: Takeaway }): ReactElement {
  const badge = BADGES[part.kind]
  return (
    <li data-commentary-part={part.kind}>
      <p className="text-fg">
        <span title={badge.title} className={`${PILL_CLASS} mr-2 align-[1px] ${badge.className}`}>{badge.text}</span>
        {part.kind !== 'pending' && part.subject ? <span className="mr-1.5 font-semibold">{part.subject}</span> : null}
        {part.kind === 'pending' ? <span className="text-muted">An analyst inference is being checked against the figures it rests on.</span> : part.text}
      </p>
      {part.kind === 'inference' && part.basis ? <p className="text-xs text-muted">Based on {part.basis}.</p> : null}
    </li>
  )
}

function OfferedChoices({ blockId, choices }: { blockId: string; choices: ReadonlyArray<string> }): ReactElement | null {
  if (useContext(OpenClarificationContext) === blockId) return null
  return (
    <ul aria-label="Options offered" className="mt-1 list-disc pl-5 text-muted">
      {choices.map((choice, index) => <li key={index}>{choice}</li>)}
    </ul>
  )
}

type RefSegmentSpanProps = {
  snapshotId: string
  blockId: string
  index: number | string
  segment: Exclude<RefSegment, { ref_kind: 'result' }>
}

// A value as the text reads it, with no padding or fill: either would show as a
// space before the punctuation after it (#303).
const REF_CLASS = 'rounded text-left text-fg-soft underline decoration-dotted underline-offset-2'

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
