import type { ReactElement } from 'react'

import { RichText } from '../blocks/RichText.tsx'
import type { RichTextBlock } from '../blocks/types.ts'
import { BlockSkeleton } from './BlockSkeleton.tsx'
import { isStreamingRichText, type StreamingBlock } from './streamReducer.ts'

type StreamingBlockViewProps = {
  block: StreamingBlock
}

// Skeleton until content arrives, then progressive rendering for rich_text
// (the only kind that streams via deltas in the current backend; other kinds
// hold the skeleton until block.completed lands and the canonical block
// arrives via the message/snapshot channel).
export function StreamingBlockView({ block }: StreamingBlockViewProps): ReactElement {
  if (isStreamingRichText(block)) {
    if (block.segments.length === 0) {
      return <BlockSkeleton blockId={block.block_id} kind="rich_text" />
    }
    return (
      <div
        data-testid={`streaming-block-${block.block_id}`}
        data-block-status={block.status}
      >
        <RichText block={toSyntheticRichTextBlock(block.block_id, block.segments)} />
      </div>
    )
  }
  return <BlockSkeleton blockId={block.block_id} kind={block.kind} />
}

// RichText accepts a fully-typed RichTextBlock. During streaming the
// not-yet-known fields are filled with stream-marker values so the renderer
// can run without waiting for the snapshot to seal. Ref segments rendered
// without a SnapshotManifestProvider fall back to placeholders, which is
// what we want pre-seal.
function toSyntheticRichTextBlock(
  block_id: string,
  segments: RichTextBlock['segments'],
): RichTextBlock {
  return {
    id: block_id,
    kind: 'rich_text',
    snapshot_id: '',
    data_ref: { kind: 'streaming', id: block_id },
    source_refs: [],
    as_of: '',
    segments,
  }
}
