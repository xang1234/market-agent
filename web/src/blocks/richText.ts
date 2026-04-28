import type { RefSegment, RichTextSegment, TextSegment } from './types.ts'

export function isTextSegment(segment: RichTextSegment): segment is TextSegment {
  return segment.type === 'text'
}

export function isRefSegment(segment: RichTextSegment): segment is RefSegment {
  return segment.type === 'ref'
}

// Display label for a ref segment whose underlying fact/claim/event has
// not yet been resolved into a value. Prefers the assistant-supplied
// `format` so reviewers see what the resolver will eventually replace.
export function refSegmentPlaceholder(segment: RefSegment): string {
  if (segment.format && segment.format.length > 0) return segment.format
  return `[${segment.ref_kind}:${segment.ref_id.slice(0, 8)}]`
}
