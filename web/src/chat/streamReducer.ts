import { REF_SEGMENT_KINDS, type RefSegmentKind, type RichTextSegment } from '../blocks/types.ts'
import type { ChatSseEvent } from './sseEventTypes.ts'

export type StreamingBlockStatus = 'pending' | 'streaming' | 'completed'

export type StreamingRichTextBlock = {
  block_id: string
  kind: 'rich_text'
  status: StreamingBlockStatus
  segments: ReadonlyArray<RichTextSegment>
}

export type StreamingOpaqueBlock = {
  block_id: string
  kind: string
  status: StreamingBlockStatus
}

export type StreamingBlock = StreamingRichTextBlock | StreamingOpaqueBlock

export function isStreamingRichText(block: StreamingBlock): block is StreamingRichTextBlock {
  return block.kind === 'rich_text'
}

export type StreamingTurnStatus = 'idle' | 'started' | 'completed' | 'error'

export type StreamState = {
  turn_status: StreamingTurnStatus
  blocks_by_id: ReadonlyMap<string, StreamingBlock>
  block_order: ReadonlyArray<string>
  // Captured from turn.completed so the consumer can fetch the canonical
  // sealed message once the snapshot has landed.
  completed_message_id: string | null
  // Captured from turn.error.
  error: string | null
}

export const INITIAL_STREAM_STATE: StreamState = Object.freeze({
  turn_status: 'idle',
  blocks_by_id: new Map<string, StreamingBlock>(),
  block_order: [],
  completed_message_id: null,
  error: null,
})

// Returns the same reference for events that don't change rendered state, so
// callers using useReducer/useState bail out of re-render via React's
// Object.is shortcut.
export function applyChatStreamEvent(state: StreamState, event: ChatSseEvent): StreamState {
  switch (event.type) {
    case 'turn.started':
      return {
        turn_status: 'started',
        blocks_by_id: new Map(),
        block_order: [],
        completed_message_id: null,
        error: null,
      }

    case 'turn.completed': {
      // Only drop the streaming block graph when we actually have a sealed
      // message_id for the parent to fetch. Without it, clearing the blocks
      // would unmount StreamingTurnView and the assistant response would
      // visibly disappear with nothing left to render. Treat the missing-id
      // case as a stream error so the UI keeps the in-flight content
      // visible and surfaces the wire-level break.
      const completedId = readString(event.message_id)
      if (completedId === null) {
        return { ...state, turn_status: 'error', error: 'turn.completed missing message_id' }
      }
      return {
        turn_status: 'completed',
        blocks_by_id: new Map(),
        block_order: [],
        completed_message_id: completedId,
        error: null,
      }
    }

    case 'turn.error':
      return {
        ...state,
        turn_status: 'error',
        error: typeof event.error === 'string' ? event.error : 'unknown stream error',
      }

    case 'block.began':
      return applyBlockBegan(state, event)

    case 'block.delta':
      return applyBlockDelta(state, event)

    case 'block.completed':
      return applyBlockCompleted(state, event)

    default:
      // tool.* and snapshot.* events don't affect block rendering state.
      return state
  }
}

function applyBlockBegan(state: StreamState, event: ChatSseEvent): StreamState {
  const block_id = readString(event.block_id)
  if (block_id === null) return state
  // Duplicate began for the same block_id is a no-op — keep the first one's
  // status (e.g., if a delta already arrived, don't reset it to pending).
  if (state.blocks_by_id.has(block_id)) return state

  const kind = readString(event.kind) ?? 'unknown'
  const block: StreamingBlock =
    kind === 'rich_text'
      ? { block_id, kind: 'rich_text', status: 'pending', segments: [] }
      : { block_id, kind, status: 'pending' }

  const blocks_by_id = new Map(state.blocks_by_id)
  blocks_by_id.set(block_id, block)
  return {
    ...state,
    blocks_by_id,
    block_order: [...state.block_order, block_id],
  }
}

function applyBlockDelta(state: StreamState, event: ChatSseEvent): StreamState {
  const block_id = readString(event.block_id)
  if (block_id === null) return state
  const existing = state.blocks_by_id.get(block_id)
  // Delta for an unknown block (begin event missed/lost) is a no-op rather
  // than silently fabricating a block — the seq gap should be visible to
  // resume logic upstream, not papered over here.
  if (existing === undefined) return state
  if (!isStreamingRichText(existing)) return state
  // A late delta after block.completed would silently undo the seal —
  // ignore. Out-of-order delivery is a wire-level concern, not a render one.
  if (existing.status === 'completed') return state

  const segment = readSegment(event.delta)
  if (segment === null) return state

  const blocks_by_id = new Map(state.blocks_by_id)
  const updated: StreamingRichTextBlock = {
    ...existing,
    status: 'streaming',
    segments: [...existing.segments, segment],
  }
  blocks_by_id.set(block_id, updated)
  return { ...state, blocks_by_id }
}

function applyBlockCompleted(state: StreamState, event: ChatSseEvent): StreamState {
  const block_id = readString(event.block_id)
  if (block_id === null) return state
  const existing = state.blocks_by_id.get(block_id)
  if (existing === undefined) return state
  if (existing.status === 'completed') return state

  const blocks_by_id = new Map(state.blocks_by_id)
  blocks_by_id.set(block_id, { ...existing, status: 'completed' })
  return { ...state, blocks_by_id }
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readSegment(deltaPayload: unknown): RichTextSegment | null {
  if (typeof deltaPayload !== 'object' || deltaPayload === null) return null
  const segment = (deltaPayload as { segment?: unknown }).segment
  if (typeof segment !== 'object' || segment === null) return null
  const candidate = segment as Record<string, unknown>
  if (candidate.type === 'text' && typeof candidate.text === 'string') {
    return { type: 'text', text: candidate.text }
  }
  if (
    candidate.type === 'ref' &&
    typeof candidate.ref_kind === 'string' &&
    (REF_SEGMENT_KINDS as readonly string[]).includes(candidate.ref_kind) &&
    typeof candidate.ref_id === 'string'
  ) {
    // ref_kind is runtime-validated against REF_SEGMENT_KINDS above; TS can't
    // narrow from an `includes` check on a typed-as-readonly-string array.
    const ref: RichTextSegment = {
      type: 'ref',
      ref_kind: candidate.ref_kind as RefSegmentKind,
      ref_id: candidate.ref_id,
    }
    if (typeof candidate.format === 'string') {
      return { ...ref, format: candidate.format }
    }
    return ref
  }
  return null
}
