import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INITIAL_STREAM_STATE,
  applyChatStreamEvent,
  type StreamState,
  type StreamingRichTextBlock,
} from './streamReducer.ts'
import type { ChatSseEvent } from './sseEventTypes.ts'

const BASE_FIELDS = {
  thread_id: 'thread-1',
  run_id: 'run-1',
  turn_id: 'turn-1',
}

function event(type: ChatSseEvent['type'], seq: number, payload: Record<string, unknown> = {}): ChatSseEvent {
  return { type, seq, ...BASE_FIELDS, ...payload }
}

test('INITIAL_STREAM_STATE is idle with no blocks', () => {
  assert.equal(INITIAL_STREAM_STATE.turn_status, 'idle')
  assert.equal(INITIAL_STREAM_STATE.blocks_by_id.size, 0)
  assert.equal(INITIAL_STREAM_STATE.block_order.length, 0)
})

test('turn.started resets the state to a fresh started turn', () => {
  // Carry-over from a previous turn's state must not leak.
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(state, event('turn.completed', 2, { message_id: 'm1' }))
  assert.equal(state.completed_message_id, 'm1')

  state = applyChatStreamEvent(state, event('turn.started', 3))
  assert.equal(state.turn_status, 'started')
  assert.equal(state.blocks_by_id.size, 0)
  assert.equal(state.block_order.length, 0)
  assert.equal(state.completed_message_id, null)
  assert.equal(state.error, null)
})

test('block.began creates a pending rich_text block in order', () => {
  const state = applyChatStreamEvent(
    INITIAL_STREAM_STATE,
    event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }),
  )
  const block = state.blocks_by_id.get('b1') as StreamingRichTextBlock | undefined
  assert.ok(block)
  assert.equal(block.kind, 'rich_text')
  assert.equal(block.status, 'pending')
  assert.deepEqual(block.segments, [])
  assert.deepEqual(state.block_order, ['b1'])
})

test('block.began for a non-rich-text kind creates an opaque pending block', () => {
  const state = applyChatStreamEvent(
    INITIAL_STREAM_STATE,
    event('block.began', 1, { block_id: 'b1', kind: 'line_chart' }),
  )
  const block = state.blocks_by_id.get('b1')
  assert.ok(block)
  assert.equal(block.kind, 'line_chart')
  assert.equal(block.status, 'pending')
})

test('block.began with a duplicate block_id is a no-op (returns same reference)', () => {
  const after_first = applyChatStreamEvent(
    INITIAL_STREAM_STATE,
    event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }),
  )
  const after_dup = applyChatStreamEvent(
    after_first,
    event('block.began', 2, { block_id: 'b1', kind: 'rich_text' }),
  )
  assert.equal(after_dup, after_first, 'duplicate began must return same state reference')
})

test('block.delta for rich_text appends a text segment and bumps status to streaming', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(
    state,
    event('block.delta', 2, {
      block_id: 'b1',
      delta: { segment: { type: 'text', text: 'Hello' } },
    }),
  )
  const block = state.blocks_by_id.get('b1') as StreamingRichTextBlock
  assert.equal(block.status, 'streaming')
  assert.deepEqual(block.segments, [{ type: 'text', text: 'Hello' }])
})

test('block.delta accepts a ref segment with ref_kind/ref_id', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(
    state,
    event('block.delta', 2, {
      block_id: 'b1',
      delta: {
        segment: {
          type: 'ref',
          ref_kind: 'fact',
          ref_id: '22222222-2222-4222-9222-222222222222',
          format: '$85B',
        },
      },
    }),
  )
  const block = state.blocks_by_id.get('b1') as StreamingRichTextBlock
  assert.deepEqual(block.segments, [
    {
      type: 'ref',
      ref_kind: 'fact',
      ref_id: '22222222-2222-4222-9222-222222222222',
      format: '$85B',
    },
  ])
})

test('block.delta for an unknown block_id is a no-op', () => {
  // Treat as a missed sequence rather than silently fabricating a block;
  // upstream resume logic should detect the gap via seq numbers.
  const state = applyChatStreamEvent(
    INITIAL_STREAM_STATE,
    event('block.delta', 1, {
      block_id: 'missing',
      delta: { segment: { type: 'text', text: 'orphan' } },
    }),
  )
  assert.equal(state, INITIAL_STREAM_STATE)
})

test('block.delta on a non-rich-text block is a no-op', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'line_chart' }))
  const after_delta = applyChatStreamEvent(
    state,
    event('block.delta', 2, {
      block_id: 'b1',
      delta: { segment: { type: 'text', text: 'noop' } },
    }),
  )
  assert.equal(after_delta, state, 'non-rich-text delta must return same state reference')
})

test('block.delta with a malformed segment payload is a no-op', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  const after_bad = applyChatStreamEvent(
    state,
    event('block.delta', 2, { block_id: 'b1', delta: { segment: { type: 'unknown' } } }),
  )
  assert.equal(after_bad, state)
})

test('block.completed flips status to completed', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(
    state,
    event('block.delta', 2, {
      block_id: 'b1',
      delta: { segment: { type: 'text', text: 'Hello' } },
    }),
  )
  state = applyChatStreamEvent(
    state,
    event('block.completed', 3, { block_id: 'b1', content_hash: 'h1' }),
  )
  const block = state.blocks_by_id.get('b1') as StreamingRichTextBlock
  assert.equal(block.status, 'completed')
  assert.deepEqual(block.segments, [{ type: 'text', text: 'Hello' }])
})

test('block.completed for an already-completed block is a no-op', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(
    state,
    event('block.completed', 2, { block_id: 'b1', content_hash: 'h1' }),
  )
  const after_dup = applyChatStreamEvent(
    state,
    event('block.completed', 3, { block_id: 'b1', content_hash: 'h1' }),
  )
  assert.equal(after_dup, state)
})

test('block.completed for an unknown block_id is a no-op', () => {
  const state = applyChatStreamEvent(
    INITIAL_STREAM_STATE,
    event('block.completed', 1, { block_id: 'missing', content_hash: 'h1' }),
  )
  assert.equal(state, INITIAL_STREAM_STATE)
})

test('turn.completed captures message_id; turn.error captures error', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('turn.completed', 1, { message_id: 'msg-1' }))
  assert.equal(state.turn_status, 'completed')
  assert.equal(state.completed_message_id, 'msg-1')

  state = applyChatStreamEvent(INITIAL_STREAM_STATE, event('turn.error', 2, { error: 'rate_limited' }))
  assert.equal(state.turn_status, 'error')
  assert.equal(state.error, 'rate_limited')
})

test('turn.completed clears blocks_by_id and block_order so memory does not grow between turns', () => {
  // The parent uses completed_message_id to fetch the canonical sealed
  // message and renders it via the standard MessageItem path; holding the
  // streaming graph past completion would pin accumulated rich_text segments
  // until the next turn.started.
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(state, event('block.delta', 2, {
    block_id: 'b1',
    delta: { segment: { type: 'text', text: 'hello' } },
  }))
  state = applyChatStreamEvent(state, event('turn.completed', 3, { message_id: 'msg-1' }))

  assert.equal(state.blocks_by_id.size, 0)
  assert.deepEqual(state.block_order, [])
  assert.equal(state.completed_message_id, 'msg-1')
})

test('turn.error mid-stream preserves partial blocks for the inline error notice', () => {
  // The view surfaces the error inline alongside whatever blocks streamed so
  // the user sees what arrived before the failure, not a blank slate.
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(state, event('block.delta', 2, {
    block_id: 'b1',
    delta: { segment: { type: 'text', text: 'partial' } },
  }))
  state = applyChatStreamEvent(state, event('turn.error', 3, { error: 'upstream_500' }))

  assert.equal(state.turn_status, 'error')
  assert.equal(state.error, 'upstream_500')
  assert.equal(state.blocks_by_id.size, 1)
  assert.deepEqual(state.block_order, ['b1'])
})

test('turn.completed followed by turn.error flips status to error (terminal-after-terminal)', () => {
  // Both are terminal events on the wire. The reducer takes the last word so
  // an error that arrives after a completed signal isn't lost.
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('turn.completed', 1, { message_id: 'msg-1' }))
  assert.equal(state.turn_status, 'completed')
  state = applyChatStreamEvent(state, event('turn.error', 2, { error: 'late_failure' }))
  assert.equal(state.turn_status, 'error')
  assert.equal(state.error, 'late_failure')
})

test('tool.* and snapshot.* events return the same state reference', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))

  for (const type of ['tool.started', 'tool.completed', 'snapshot.staged', 'snapshot.sealed'] as const) {
    const after = applyChatStreamEvent(state, event(type, 99, { tool_call_id: 't1', tool_name: 'x', snapshot_id: 's1' }))
    assert.equal(after, state, `${type} must return same state reference`)
  }
})

test('multi-block sequence preserves block_order and per-block segments through to block.completed', () => {
  // Validates the streaming graph at the moment all blocks have completed
  // but before turn.completed clears the graph (the latter is asserted by
  // the dedicated clear-on-completed test).
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('turn.started', 1))
  state = applyChatStreamEvent(state, event('block.began', 2, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(state, event('block.began', 3, { block_id: 'b2', kind: 'line_chart' }))
  state = applyChatStreamEvent(state, event('block.delta', 4, {
    block_id: 'b1',
    delta: { segment: { type: 'text', text: 'first' } },
  }))
  state = applyChatStreamEvent(state, event('block.delta', 5, {
    block_id: 'b1',
    delta: { segment: { type: 'text', text: ' second' } },
  }))
  state = applyChatStreamEvent(state, event('block.completed', 6, { block_id: 'b1', content_hash: 'h1' }))
  state = applyChatStreamEvent(state, event('block.completed', 7, { block_id: 'b2', content_hash: 'h2' }))

  assert.deepEqual(state.block_order, ['b1', 'b2'])
  const b1 = state.blocks_by_id.get('b1') as StreamingRichTextBlock
  assert.equal(b1.status, 'completed')
  assert.deepEqual(b1.segments, [
    { type: 'text', text: 'first' },
    { type: 'text', text: ' second' },
  ])
  const b2 = state.blocks_by_id.get('b2')
  assert.equal(b2?.status, 'completed')
  assert.equal(state.turn_status, 'started')

  state = applyChatStreamEvent(state, event('turn.completed', 8, { message_id: 'msg-1' }))
  assert.equal(state.turn_status, 'completed')
  assert.equal(state.completed_message_id, 'msg-1')
})
