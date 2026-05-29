import type { ReactElement } from 'react'
import { InspectableRef } from '../evidence/InspectableRef.tsx'
import type { RefSegment, RichTextBlock } from './types.ts'
import { isRefSegment, refSegmentPlaceholder } from './richText.ts'
import { resolveRefSegment, type SnapshotManifest } from './snapshotManifest.ts'
import { useSnapshotManifest } from './snapshotManifestContext.ts'

type RichTextProps = { block: RichTextBlock }

export function RichText({ block }: RichTextProps): ReactElement {
  const manifest = useSnapshotManifest()
  return (
    <p
      data-testid={`block-rich-text-${block.id}`}
      data-block-kind="rich_text"
      className="text-sm leading-6 text-neutral-800 dark:text-neutral-200"
    >
      {block.segments.map((segment, index) => {
        if (isRefSegment(segment)) {
          return (
            <RefSegmentSpan
              key={`${block.id}-seg-${index}`}
              snapshotId={block.snapshot_id}
              blockId={block.id}
              index={index}
              segment={segment}
              manifest={manifest}
            />
          )
        }
        return <span key={`${block.id}-seg-${index}`}>{segment.text}</span>
      })}
    </p>
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
        className="rounded bg-neutral-100 px-1 text-neutral-700 underline decoration-dotted dark:bg-neutral-800 dark:text-neutral-200"
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
        className="rounded bg-rose-100 px-1 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200"
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
      className="rounded px-1 text-neutral-800 underline decoration-dotted underline-offset-2 dark:text-neutral-200"
    >
      {resolved.value}
    </InspectableRef>
  )
}
