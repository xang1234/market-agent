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

const SEALED = {
  message_id: 'msg-1',
  thread_id: 'thread-1',
  role: 'assistant',
  snapshot_id: 'snap-1',
  blocks: [{ id: 'b1', kind: 'rich_text', segments: [{ type: 'text', text: 'hello' }] }],
  content_hash: 'sha256:msg-1',
  created_at: '2026-05-06T00:00:00.000Z',
  answered_by: 'fixture/recorded',
  block_proofs: { b1: { evidence: 'unknown', calculation: 'not_verified', public_by_cutoff: 'unknown' } },
}

function completed(seq: number, payload: Record<string, unknown> = {}): ChatSseEvent {
  return event('turn.completed', seq, { message_id: 'msg-1', message: SEALED, ...payload })
}

test('INITIAL_STREAM_STATE is idle with no blocks', () => {
  assert.equal(INITIAL_STREAM_STATE.turn_status, 'idle')
  assert.equal(INITIAL_STREAM_STATE.blocks_by_id.size, 0)
  assert.equal(INITIAL_STREAM_STATE.block_order.length, 0)
  assert.equal(INITIAL_STREAM_STATE.plan_steps.length, 0)
})

test('turn.started resets the state to a fresh started turn', () => {
  // Carry-over from a previous turn's state must not leak.
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(state, completed(2))
  assert.equal(state.turn_status === 'completed' ? state.sealed.message_id : null, 'msg-1')

  state = applyChatStreamEvent(state, event('turn.started', 3))
  assert.equal(state.turn_status, 'started')
  assert.equal(state.blocks_by_id.size, 0)
  assert.equal(state.block_order.length, 0)
  assert.deepEqual(state.plan_steps.map((step) => [step.label, step.status]), [
    ['Planner', 'running'],
    ['Composer', 'waiting'],
  ])
  assert.equal('sealed' in state, false)
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

test('block.delta accepts a series ref segment', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  const segment = { type: 'ref', ref_kind: 'series', ref_id: '33333333-3333-4333-8333-333333333333', format: '6.6%' }
  state = applyChatStreamEvent(state, event('block.delta', 2, { block_id: 'b1', delta: { segment } }))
  assert.deepEqual((state.blocks_by_id.get('b1') as StreamingRichTextBlock).segments, [
    { type: 'ref', ref_kind: 'series', ref_id: '33333333-3333-4333-8333-333333333333', format: '6.6%' },
  ])
})

test('block.delta accepts an engine result ref segment, with its period', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  const segment = { type: 'ref', ref_kind: 'result', ref_id: '44444444-4444-4444-8444-444444444444', format: '74.40%', period: 'Q4 FY2026' }
  state = applyChatStreamEvent(state, event('block.delta', 2, { block_id: 'b1', delta: { segment } }))
  assert.deepEqual((state.blocks_by_id.get('b1') as StreamingRichTextBlock).segments, [segment])
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

test('turn.completed captures the sealed message; turn.error captures error', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, completed(1))
  assert.equal(state.turn_status, 'completed')
  assert.deepEqual(state.sealed, {
    message_id: 'msg-1',
    thread_id: 'thread-1',
    role: 'assistant',
    snapshot_id: 'snap-1',
    blocks: [{ id: 'b1', kind: 'rich_text', segments: [{ type: 'text', text: 'hello' }] }],
    content_hash: 'sha256:msg-1',
    created_at: '2026-05-06T00:00:00.000Z',
    answered_by: 'fixture/recorded',
    block_proofs: { b1: { evidence: 'unknown', calculation: 'not_verified', public_by_cutoff: 'unknown' } },
  })

  state = applyChatStreamEvent(INITIAL_STREAM_STATE, event('turn.error', 2, { error: 'rate_limited' }))
  assert.equal(state.turn_status, 'error')
  assert.equal(state.error, 'rate_limited')
})

test('turn.completed keeps block_order ["b1"] and holds the sealed message "msg-1"', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(state, event('block.delta', 2, {
    block_id: 'b1',
    delta: { segment: { type: 'text', text: 'hello' } },
  }))
  state = applyChatStreamEvent(state, completed(3))

  assert.equal(state.turn_status, 'completed')
  assert.deepEqual(state.block_order, ['b1'])
  assert.deepEqual((state.blocks_by_id.get('b1') as StreamingRichTextBlock).segments, [{ type: 'text', text: 'hello' }])
  assert.equal(state.turn_status === 'completed' ? state.sealed.message_id : null, 'msg-1')
})

test('a completion without a valid sealed message is unsealed and keeps the streamed graph', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(state, event('block.delta', 2, {
    block_id: 'b1',
    delta: { segment: { type: 'text', text: 'partial' } },
  }))
  const malformed: Record<string, Record<string, unknown>> = {
    'no message': { message: undefined },
    'no message_id': { message_id: undefined },
    'another message id': { message_id: 'msg-2' },
    'another thread': { message: { ...SEALED, thread_id: 'thread-2' } },
    'a user message': { message: { ...SEALED, role: 'user' } },
    'no block_proofs': { message: { ...SEALED, block_proofs: undefined } },
    'block_proofs an array': { message: { ...SEALED, block_proofs: [] } },
    'a proof value outside its enum': { message: { ...SEALED, block_proofs: { b1: { ...SEALED.block_proofs.b1, evidence: 'maybe' } } } },
    'a block without an id': { message: { ...SEALED, blocks: [{ kind: 'rich_text' }] } },
    'blocks not an array': { message: { ...SEALED, blocks: {} } },
    'no created_at': { message: { ...SEALED, created_at: 7 } },
  }
  for (const [name, payload] of Object.entries(malformed)) {
    const after = applyChatStreamEvent(state, completed(3, payload))
    assert.equal(after.turn_status, 'unsealed', name)
    assert.equal('sealed' in after, false, name)
    assert.equal(after.error, 'turn.completed carried no valid sealed message', name)
    assert.deepEqual(after.block_order, ['b1'], `${name}: the streamed graph stays`)
    assert.equal(after.plan_steps.find((step) => step.step_id === 'composer')?.status, 'error', name)
  }
  const unsealedIds = Object.fromEntries(Object.entries(malformed).slice(0, 4).map(([name, payload]) => {
    const after = applyChatStreamEvent(state, completed(3, payload))
    return [name, after.turn_status === 'unsealed' ? after.message_id : 'not unsealed']
  }))
  assert.deepEqual(unsealedIds, {
    'no message': 'msg-1',
    'no message_id': null,
    'another message id': 'msg-2',
    'another thread': 'msg-1',
  })
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

test('turn.error accepts backend message payloads and marks running plan steps failed', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('turn.started', 1))
  state = applyChatStreamEvent(state, event('turn.error', 2, { message: 'snapshot verification failed' }))

  assert.equal(state.turn_status, 'error')
  assert.equal(state.error, 'snapshot verification failed')
  assert.equal(state.plan_steps.find((step) => step.step_id === 'planner')?.status, 'error')
})

test('late block.completed after turn.error does not flip composer back to done', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('turn.started', 1))
  state = applyChatStreamEvent(state, event('block.began', 2, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(state, event('turn.error', 3, { message: 'snapshot verification failed' }))

  assert.equal(state.turn_status, 'error')
  assert.equal(state.error, 'snapshot verification failed')
  assert.equal(state.plan_steps.find((step) => step.step_id === 'composer')?.status, 'error')

  state = applyChatStreamEvent(state, event('block.completed', 4, { block_id: 'b1', content_hash: 'h1' }))

  assert.equal(state.turn_status, 'error')
  assert.equal(state.error, 'snapshot verification failed')
  assert.equal(state.plan_steps.find((step) => step.step_id === 'composer')?.status, 'error')
})

test('block.delta after block.completed is a no-op (sealed block stays sealed)', () => {
  // A late delta arriving after the seal would otherwise silently undo the
  // completed status and append more content to a "finalized" block.
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('block.began', 1, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(state, event('block.delta', 2, {
    block_id: 'b1',
    delta: { segment: { type: 'text', text: 'in flight' } },
  }))
  state = applyChatStreamEvent(state, event('block.completed', 3, { block_id: 'b1', content_hash: 'h1' }))
  const after_late = applyChatStreamEvent(state, event('block.delta', 4, {
    block_id: 'b1',
    delta: { segment: { type: 'text', text: ' too late' } },
  }))
  assert.equal(after_late, state, 'late delta after completed must return same state reference')
})

test('events with empty or whitespace-only block_id are no-ops (matches backend assertNonEmptyString)', () => {
  for (const block_id of ['', '   ', '\t\n']) {
    const after = applyChatStreamEvent(
      INITIAL_STREAM_STATE,
      event('block.began', 1, { block_id, kind: 'rich_text' }),
    )
    assert.equal(after, INITIAL_STREAM_STATE, `block_id="${block_id}" must be rejected`)
  }
})

test('turn.completed followed by turn.error flips status to error (terminal-after-terminal)', () => {
  // Both are terminal events on the wire. The reducer takes the last word so
  // an error that arrives after a completed signal isn't lost.
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, completed(1))
  assert.equal(state.turn_status, 'completed')
  state = applyChatStreamEvent(state, event('turn.error', 2, { error: 'late_failure' }))
  assert.equal(state.turn_status, 'error')
  assert.equal(state.error, 'late_failure')
})

test('tool and snapshot events update the streamed agent plan from real SSE payloads', () => {
  let state: StreamState = INITIAL_STREAM_STATE
  state = applyChatStreamEvent(state, event('turn.started', 1, { bundle_id: 'single_subject_analysis' }))
  state = applyChatStreamEvent(state, event('tool.started', 2, {
    tool_call_id: 'resolve-1',
    tool_name: 'resolve_subjects',
  }))
  assert.deepEqual(state.plan_steps.map((step) => [step.label, step.status]), [
    ['Planner', 'running'],
    ['Composer', 'waiting'],
  ])

  state = applyChatStreamEvent(state, event('tool.completed', 3, {
    tool_call_id: 'resolve-1',
    tool_name: 'resolve_subjects',
    resolution_status: 'resolved',
  }))
  state = applyChatStreamEvent(state, event('tool.started', 4, {
    tool_call_id: 'fundamentals-1',
    tool_name: 'compose_analyst_blocks',
  }))
  assert.deepEqual(state.plan_steps.map((step) => [step.label, step.status]), [
    ['Planner', 'done'],
    ['Composer', 'waiting'],
    ['Fundamentals', 'running'],
  ])

  state = applyChatStreamEvent(state, event('tool.completed', 5, {
    tool_call_id: 'fundamentals-1',
    tool_name: 'compose_analyst_blocks',
    status: 'ok',
  }))
  state = applyChatStreamEvent(state, event('snapshot.staged', 6, { snapshot_id: 'snap-1' }))
  state = applyChatStreamEvent(state, event('snapshot.sealed', 7, { snapshot_id: 'snap-1' }))
  assert.deepEqual(state.plan_steps.map((step) => [step.label, step.status]), [
    ['Planner', 'done'],
    ['Composer', 'waiting'],
    ['Fundamentals', 'done'],
    ['Snapshot', 'done'],
  ])

  state = applyChatStreamEvent(state, event('block.began', 8, { block_id: 'b1', kind: 'rich_text' }))
  assert.equal(state.plan_steps.find((step) => step.step_id === 'composer')?.status, 'running')
  state = applyChatStreamEvent(state, event('block.completed', 9, { block_id: 'b1', content_hash: 'h1' }))
  assert.equal(state.plan_steps.find((step) => step.step_id === 'composer')?.status, 'done')
})

test('the sealed snapshot id outlives the deltas that follow it, and the next turn starts without one', () => {
  let state: StreamState = applyChatStreamEvent(INITIAL_STREAM_STATE, event('turn.started', 1))
  state = applyChatStreamEvent(state, event('snapshot.sealed', 2, { snapshot_id: '72fe1508-c2ab-4176-83d7-6ffe178f7a8b' }))
  state = applyChatStreamEvent(state, event('block.began', 3, { block_id: 'b1', kind: 'rich_text' }))
  state = applyChatStreamEvent(state, event('block.delta', 4, {
    block_id: 'b1',
    delta: { segment: { type: 'ref', ref_kind: 'fact', ref_id: 'f-1', format: '$62.1B' } },
  }))
  assert.equal(state.snapshot_id, '72fe1508-c2ab-4176-83d7-6ffe178f7a8b')

  state = applyChatStreamEvent(state, event('turn.started', 5))
  assert.equal(state.snapshot_id, null)
})

test('multi-block sequence preserves block_order and per-block segments through to block.completed', () => {
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

  state = applyChatStreamEvent(state, completed(8))
  assert.equal(state.turn_status, 'completed')
  assert.equal(state.turn_status === 'completed' ? state.sealed.message_id : null, 'msg-1')
})

const UNVERIFIED_BLOCK = {
  id: 'b-unverified',
  kind: 'revenue_bars',
  snapshot_id: '11111111-1111-4111-a111-111111111111',
  data_ref: { kind: 'chat_turn', id: 'turn-1' },
  source_refs: [],
  as_of: '2026-05-06T00:00:00.000Z',
}

test('turn.completed with unverified keeps the blocks and reasons instead of waiting for a saved message', () => {
  const started = applyChatStreamEvent(INITIAL_STREAM_STATE, event('turn.started', 1))
  const next = applyChatStreamEvent(started, event('turn.completed', 2, {
    unverified: { persisted: false, failures: [{ reason_code: 'missing_fact_ref' }], blocks: [UNVERIFIED_BLOCK] },
  }))

  assert.equal(next.turn_status, 'unverified')
  assert.equal('sealed' in next, false)
  assert.equal(next.error, null)
  assert.deepEqual(next.unverified, { failures: [{ reason_code: 'missing_fact_ref' }], blocks: [UNVERIFIED_BLOCK] })
})

test('turn.started clears a previous unverified turn', () => {
  const unverified = applyChatStreamEvent(
    applyChatStreamEvent(INITIAL_STREAM_STATE, event('turn.started', 1)),
    event('turn.completed', 2, { unverified: { persisted: false, failures: [], blocks: [UNVERIFIED_BLOCK] } }),
  )
  const restarted = applyChatStreamEvent(unverified, event('turn.started', 1))

  assert.equal(restarted.turn_status, 'started')
  assert.equal(restarted.unverified ?? null, null)
})

const SHOWN = {
  message_id: 'msg-1',
  snapshot_id: 'snap-1',
  blocks: [{ id: 'b1', kind: 'rich_text', segments: [{ type: 'text', text: 'Revenue rose.' }] }],
  block_proofs: { b1: { evidence: 'linked', calculation: 'not_verified', public_by_cutoff: 'unknown' } },
}

test('answer.shown holds the sealed answer until the saved message replaces it; a malformed one changes nothing', () => {
  let state: StreamState = applyChatStreamEvent(INITIAL_STREAM_STATE, event('turn.started', 1))
  state = applyChatStreamEvent(state, event('answer.shown', 2, SHOWN))
  assert.deepEqual(state.shown, SHOWN)
  assert.equal(applyChatStreamEvent(state, event('answer.shown', 3, { ...SHOWN, block_proofs: { b1: { evidence: 'maybe' } } })), state)
  assert.equal(applyChatStreamEvent(state, event('answer.shown', 3, { ...SHOWN, snapshot_id: '' })), state)
  assert.equal(applyChatStreamEvent(state, completed(4)).turn_status, 'completed')
})

test('a later answer.shown for the same message replaces the one shown: each verdict brings the answer as it now stands', () => {
  const settled = { ...SHOWN, blocks: [{ id: 'b1', kind: 'rich_text', segments: [{ type: 'text', text: 'Revenue rose. Margins held.' }] }] }
  let state: StreamState = applyChatStreamEvent(INITIAL_STREAM_STATE, event('turn.started', 1))
  state = applyChatStreamEvent(state, event('answer.shown', 2, SHOWN))
  state = applyChatStreamEvent(state, event('answer.shown', 3, settled))
  assert.deepEqual(state.shown, settled)
})

test('a failed turn saved nothing, so it drops the answer it showed; a new turn starts with none', () => {
  const shown = applyChatStreamEvent(applyChatStreamEvent(INITIAL_STREAM_STATE, event('turn.started', 1)), event('answer.shown', 2, SHOWN))
  assert.equal(applyChatStreamEvent(shown, event('turn.error', 3, { error: 'connection terminated' })).shown, null)
  assert.equal(applyChatStreamEvent(shown, event('turn.started', 3)).shown, null)
})
