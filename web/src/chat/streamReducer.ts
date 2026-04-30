import type { RichTextSegment } from '../blocks/types.ts'
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

// Type guard: TS can't auto-narrow on `kind === 'rich_text'` because
// StreamingOpaqueBlock.kind is `string` (any string is assignable, including
// the literal 'rich_text').
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

    case 'turn.completed':
      return {
        ...state,
        turn_status: 'completed',
        completed_message_id:
          typeof event.message_id === 'string' ? event.message_id : null,
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
  return typeof value === 'string' && value.length > 0 ? value : null
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
    (candidate.ref_kind === 'fact' ||
      candidate.ref_kind === 'claim' ||
      candidate.ref_kind === 'event') &&
    typeof candidate.ref_id === 'string'
  ) {
    const ref: RichTextSegment = {
      type: 'ref',
      ref_kind: candidate.ref_kind,
      ref_id: candidate.ref_id,
    }
    if (typeof candidate.format === 'string') {
      return { ...ref, format: candidate.format }
    }
    return ref
  }
  return null
}
