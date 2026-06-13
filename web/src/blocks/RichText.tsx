import type { ReactElement } from 'react'
import { InspectableRef } from '../evidence/InspectableRef.tsx'
import type { RefSegment, RichTextBlock, TextSegmentTone } from './types.ts'
import { isRefSegment, refSegmentPlaceholder } from './richText.ts'
import { resolveRefSegment, type SnapshotManifest } from './snapshotManifest.ts'
import { useSnapshotManifest } from './snapshotManifestContext.ts'
import { Markdown } from './Markdown.tsx'

type RichTextProps = { block: RichTextBlock }

// Inline emphasis for toned text runs (the video's green "+127% YoY" deltas).
// Neutral tone is intentionally unstyled — it exists so emitters can be
// explicit without changing rendering.
const TONE_CLASS: Readonly<Record<TextSegmentTone, string>> = {
  positive: 'font-medium text-positive',
  negative: 'font-medium text-negative',
  neutral: '',
}

export function RichText({ block }: RichTextProps): ReactElement {
  const manifest = useSnapshotManifest()
  // A block that is a single text segment is whole-block prose — render it as
  // block-level Markdown so GFM tables, headings, and lists work (the redesign's
  // goal). A block that interleaves text and ref segments is an inline cited
  // sentence; rendering each text run as block Markdown (<div>/<p>) would split
  // the refs onto their own lines, so render those text runs inline instead and
  // keep the refs in flow. A positively/negatively toned single segment takes
  // the inline path (Markdown has no tone treatment); neutral is by definition
  // unstyled, so it keeps the Markdown fast-path.
  const onlySegment = block.segments.length === 1 ? block.segments[0] : null
  const children =
    onlySegment &&
    !isRefSegment(onlySegment) &&
    (onlySegment.tone === undefined || onlySegment.tone === 'neutral')
    ? <Markdown text={onlySegment.text} />
    : block.segments.map((segment, index) =>
        isRefSegment(segment)
          ? (
            <RefSegmentSpan
              key={`${block.id}-seg-${index}`}
              snapshotId={block.snapshot_id}
              blockId={block.id}
              index={index}
              segment={segment}
              manifest={manifest}
            />
          )
          : (
            <span
              key={`${block.id}-seg-${index}`}
              data-tone={segment.tone}
              className={segment.tone !== undefined ? TONE_CLASS[segment.tone] : undefined}
            >
              {segment.text}
            </span>
          ),
      )
  return (
    <div
      data-testid={`block-rich-text-${block.id}`}
      data-block-kind="rich_text"
      className="text-sm leading-6 text-fg-soft"
    >
      {children}
    </div>
  )
}

type RefSegmentSpanProps = {
  snapshotId: string
  blockId: string
  index: number
  segment: RefSegment
  manifest: SnapshotManifest | null
}

function RefSegmentSpan({ snapshotId, blockId, index, segment, manifest }: RefSegmentSpanProps): ReactElement {
  const baseAttrs = {
    'data-ref-kind': segment.ref_kind,
    'data-ref-id': segment.ref_id,
  }
  const inspectionRef = { kind: segment.ref_kind, id: segment.ref_id }
  if (manifest === null) {
    return (
      <InspectableRef
        snapshotId={snapshotId}
        inspectionRef={inspectionRef}
        testId={`block-rich-text-${blockId}-ref-${index}`}
        dataAttrs={{ ...baseAttrs, 'data-ref-state': 'placeholder' }}
        className="rounded bg-surface-2 px-1 text-fg-soft underline decoration-dotted"
      >
        {refSegmentPlaceholder(segment)}
      </InspectableRef>
    )
  }
  const resolved = resolveRefSegment(manifest, segment)
  if (resolved.state === 'unresolved') {
    return (
      <InspectableRef
        snapshotId={snapshotId}
        inspectionRef={inspectionRef}
        testId={`block-rich-text-${blockId}-ref-${index}`}
        dataAttrs={{ ...baseAttrs, 'data-ref-state': 'unresolved' }}
        className="rounded bg-negative-soft px-1 text-negative"
      >
        [unresolved {segment.ref_kind}]
      </InspectableRef>
    )
  }
  return (
    <InspectableRef
      snapshotId={snapshotId}
      inspectionRef={inspectionRef}
      testId={`block-rich-text-${blockId}-ref-${index}`}
      dataAttrs={{ ...baseAttrs, 'data-ref-state': 'resolved' }}
      className="rounded px-1 text-fg-soft underline decoration-dotted underline-offset-2"
    >
      {resolved.value}
    </InspectableRef>
  )
}
