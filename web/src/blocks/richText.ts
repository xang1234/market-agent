import type { CitationRef, CommentaryPart, RefSegment, RichTextSegment, TextSegment } from './types.ts'

export function isTextSegment(segment: RichTextSegment): segment is TextSegment {
  return segment.type === 'text'
}

export function isRefSegment(segment: RichTextSegment): segment is RefSegment {
  return segment.type === 'ref'
}

export function refSegmentText(segment: RefSegment): string {
  if (segment.format && segment.format.length > 0) return segment.format
  return `[${segment.ref_kind}:${segment.ref_id.slice(0, 8)}]`
}

// A quote's ref, shown as a numbered citation: a claim, or the source of a claim with no claim row.
export function isCitationRef(segment: RichTextSegment): segment is CitationRef {
  return segment.type === 'ref' && (segment.ref_kind === 'claim' || segment.ref_kind === 'source')
}

export function citationNumbers(segments: ReadonlyArray<RichTextSegment>): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>()
  for (const segment of segments) {
    if (isCitationRef(segment) && !numbers.has(segment.ref_id)) numbers.set(segment.ref_id, numbers.size + 1)
  }
  return numbers
}

export type Takeaway = Extract<CommentaryPart, { kind: 'inference' | 'unverified' | 'pending' }>
type Statement = Extract<CommentaryPart, { kind: 'figures' }>

const isTakeaway = (part: CommentaryPart): part is Takeaway => part.kind === 'inference' || part.kind === 'unverified' || part.kind === 'pending'

// Commentary as its card shows it, and as a copy of it reads: the takeaways,
// then the figures, then the quotes, then the notes, its citations numbered in
// that order.
export function commentaryCard(parts: ReadonlyArray<CommentaryPart>) {
  const takeaways = parts.filter(isTakeaway)
  const statements = parts.filter((part): part is Statement => part.kind === 'figures')
  const isQuote = (part: Statement) => part.segments.some(isCitationRef)
  const figures = statements.filter((part) => !isQuote(part))
  const quotes = statements.filter(isQuote)
  const notes = parts.flatMap((part) => (part.kind === 'note' ? [part.text] : []))
  const numbers = citationNumbers([
    ...takeaways.flatMap((part) => (part.kind === 'inference' ? part.cites ?? [] : [])),
    ...[...figures, ...quotes].flatMap((part) => part.segments),
  ])
  return { takeaways, figures, quotes, notes, numbers }
}
