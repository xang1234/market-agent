import type { ReactElement } from 'react'
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
  blockId: string
  index: number
  segment: RefSegment
  manifest: SnapshotManifest | null
}

function RefSegmentSpan({ blockId, index, segment, manifest }: RefSegmentSpanProps): ReactElement {
  const baseAttrs = {
    'data-testid': `block-rich-text-${blockId}-ref-${index}`,
    'data-ref-kind': segment.ref_kind,
    'data-ref-id': segment.ref_id,
  }
  if (manifest === null) {
    return (
      <span
        {...baseAttrs}
        data-ref-state="placeholder"
        className="rounded bg-neutral-100 px-1 text-neutral-700 underline decoration-dotted dark:bg-neutral-800 dark:text-neutral-200"
      >
        {refSegmentPlaceholder(segment)}
      </span>
    )
  }
  const resolved = resolveRefSegment(manifest, segment)
  if (resolved.state === 'unresolved') {
    return (
      <span
        {...baseAttrs}
        data-ref-state="unresolved"
        title={`Missing ${segment.ref_kind} reference: ${segment.ref_id}`}
        className="rounded bg-rose-100 px-1 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200"
      >
        [unresolved {segment.ref_kind}]
      </span>
    )
  }
  return (
    <span {...baseAttrs} data-ref-state="resolved">
      {resolved.value}
    </span>
  )
}
