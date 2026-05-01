import { memo, useMemo, type ReactElement } from 'react'

import { RichText } from '../blocks/RichText.tsx'
import { STREAMING_DATA_REF_KIND, type RichTextBlock } from '../blocks/types.ts'
import { BlockSkeleton } from './BlockSkeleton.tsx'
import { isStreamingRichText, type StreamingBlock } from './streamReducer.ts'

type StreamingBlockViewProps = {
  block: StreamingBlock
}

// Skeleton until content arrives, then progressive rendering for rich_text
// (the only kind that streams via deltas; other kinds hold the skeleton
// until block.completed lands and the canonical block arrives via the
// message channel).
function StreamingBlockViewInner({ block }: StreamingBlockViewProps): ReactElement {
  if (isStreamingRichText(block)) {
    if (block.segments.length === 0) {
      return <BlockSkeleton blockId={block.block_id} kind="rich_text" />
    }
    return <StreamingRichTextBlock blockId={block.block_id} segments={block.segments} status={block.status} />
  }
  return <BlockSkeleton blockId={block.block_id} kind={block.kind} />
}

// memo bailout: applyBlockDelta only allocates a new StreamingBlock for the
// delta'd block_id, so unchanged siblings keep stable references — without
// memo, every delta re-renders all streaming blocks because the parent's
// `state` is always a new object.
export const StreamingBlockView = memo(StreamingBlockViewInner)

type StreamingRichTextBlockProps = {
  blockId: string
  segments: RichTextBlock['segments']
  status: string
}

// Memoizes the synthetic RichTextBlock envelope so RichText sees a stable
// reference across renders that don't change segments — pairs with the memo
// on StreamingBlockView to keep RichText off the hot path during deltas to
// other blocks.
function StreamingRichTextBlock({ blockId, segments, status }: StreamingRichTextBlockProps): ReactElement {
  const richTextBlock = useMemo<RichTextBlock>(
    () => ({
      id: blockId,
      kind: 'rich_text',
      // The renderer doesn't read these fields, but RichTextBlock is
      // structurally typed — fill with stream-marker values so a ref
      // resolver downstream can detect "no snapshot yet" via data_ref.kind.
      snapshot_id: '',
      data_ref: { kind: STREAMING_DATA_REF_KIND, id: blockId },
      source_refs: [],
      as_of: '',
      segments,
    }),
    [blockId, segments],
  )
  return (
    <div data-testid={`streaming-block-${blockId}`} data-block-status={status}>
      <RichText block={richTextBlock} />
    </div>
  )
}
