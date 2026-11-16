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
      <Markdown text={markdownParts(block, block.segments, citationNumbers(block.segments))} />
      {block.clarification_choices ? <OfferedChoices blockId={block.id} choices={block.clarification_choices} /> : null}
    </div>
  )
}

// Each claim a block cites, numbered in the order the reader meets it.
function citationNumbers(segments: ReadonlyArray<RichTextSegment>): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>()
  for (const segment of segments) {
    if (isRefSegment(segment) && segment.ref_kind === 'claim' && !numbers.has(segment.ref_id)) numbers.set(segment.ref_id, numbers.size + 1)
  }
  return numbers
}

const isQuote = (part: { segments: ReadonlyArray<RichTextSegment> }) => part.segments.some((segment) => isRefSegment(segment) && segment.ref_kind === 'claim')

// Segments as Markdown source, each ref an inspectable value. key keeps the
// refs of several runs in one block apart.
function markdownParts(block: RichTextBlock, segments: ReadonlyArray<RichTextSegment>, numbers: ReadonlyMap<string, number>, key = '') {
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
      if (segment.ref_kind === 'claim') {
        return (
          <>
            <span data-claim-quote>{`“${refSegmentText(segment)}”`}</span>
            <Citation snapshotId={block.snapshot_id} blockId={block.id} index={`${key}${index}`} segment={segment} number={numbers.get(segment.ref_id)!} />
          </>
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
  const statements = parts.flatMap((part) => (part.kind === 'figures' ? [part] : []))
  const figures = statements.filter((part) => !isQuote(part))
  const quotes = statements.filter(isQuote)
  const notes = parts.flatMap((part) => (part.kind === 'note' ? [part.text] : []))
  const numbers = citationNumbers([
    ...takeaways.flatMap((part) => (part.kind === 'inference' ? part.cites ?? [] : [])),
    ...[...figures, ...quotes].flatMap((part) => part.segments),
  ])
  const list = (title: string, key: string, items: typeof statements) => (
    <div>
      <h4 className="text-xs font-medium text-muted">{title}</h4>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
        {items.map((part, index) => <li key={index}><Markdown text={markdownParts(block, part.segments, numbers, `${key}-${index}-`)} /></li>)}
      </ul>
    </div>
  )
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
          {takeaways.map((part, index) => <TakeawayItem key={index} block={block} part={part} numbers={numbers} />)}
        </ul>
      ) : null}
      {figures.length > 0 ? list('Supporting figures', 'figures', figures) : null}
      {quotes.length > 0 ? list('Quoted sources', 'quotes', quotes) : null}
      {notes.length > 0 ? <p className="text-xs text-muted">{notes.join(' ')}</p> : null}
    </section>
  )
}

function TakeawayItem({ block, part, numbers }: { block: RichTextBlock; part: Takeaway; numbers: ReadonlyMap<string, number> }): ReactElement {
  const badge = BADGES[part.kind]
  return (
    <li data-commentary-part={part.kind}>
      <p className="text-fg">
        <span title={badge.title} className={`${PILL_CLASS} mr-2 align-[1px] ${badge.className}`}>{badge.text}</span>
        {part.kind !== 'pending' && part.subject ? <span className="mr-1.5 font-semibold">{part.subject}</span> : null}
        {part.kind === 'pending' ? <span className="text-muted">An analyst inference is being checked against the figures it rests on.</span> : part.text}
        {part.kind === 'inference' ? (part.cites ?? []).map((cite, index) => (
          <Citation key={cite.ref_id} snapshotId={block.snapshot_id} blockId={block.id} index={`cite-${index}`} segment={cite} number={numbers.get(cite.ref_id)!} quoted />
        )) : null}
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

// A claim's footnote marker: it opens the claim, its filing and its date. One
// standing for a quote not on the page shows the quote on hover.
const CITATION_CLASS = 'relative -top-[0.45em] ml-0.5 text-[0.7em] font-medium leading-none text-accent hover:underline'

function Citation({ snapshotId, blockId, index, segment, number, quoted = false }: Omit<RefSegmentSpanProps, 'segment'> & {
  segment: RefSegment
  number: number
  quoted?: boolean
}): ReactElement {
  return (
    <span title={quoted ? refSegmentText(segment) : undefined}>
      <InspectableRef
        snapshotId={snapshotId}
        inspectionRef={{ kind: 'claim', id: segment.ref_id }}
        testId={`block-rich-text-${blockId}-ref-${index}`}
        dataAttrs={{ 'data-ref-kind': 'claim', 'data-ref-id': segment.ref_id }}
        className={CITATION_CLASS}
      >
        <span aria-hidden="true">[{number}]</span>
        <span className="sr-only">Source {number}</span>
      </InspectableRef>
    </span>
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
