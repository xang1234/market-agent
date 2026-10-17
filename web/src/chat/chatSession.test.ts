import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INITIAL_CHAT_SESSION,
  reduceChatSession,
  selectThreadView,
  wantedStream,
  type ChatSessionAction,
  type ChatSessionState,
  type TurnIds,
  type TurnState,
} from './chatSession.ts'
import type { ChatMessage, RunStatus } from './messageTypes.ts'
import type { ChatSseEvent } from './sseEventTypes.ts'
import type { StreamingRichTextBlock } from './streamReducer.ts'

const TURN: TurnIds = { runId: 'run-1', messageId: 'u1', snapshotId: 'snap-1', text: 'Analyze NVDA' }

function message(id: string, role: ChatMessage['role'], text: string): ChatMessage {
  return {
    message_id: id,
    thread_id: 'T1',
    role,
    snapshot_id: 'snap-1',
    blocks: [{
      id: `${id}-b`,
      kind: 'rich_text',
      snapshot_id: 'snap-1',
      data_ref: { kind: 'chat_turn', id },
      source_refs: [],
      as_of: '2026-05-06T00:00:00.000Z',
      segments: [{ type: 'text', text }],
    }],
    content_hash: `sha256:${id}`,
    created_at: '2026-05-06T00:00:00.000Z',
  }
}

const U1 = message('u1', 'user', 'Analyze NVDA')
const A1 = message('a1', 'assistant', "NVIDIA's revenue rose")
const A1_SEALED: ChatMessage = {
  ...A1,
  block_proofs: { 'a1-b': { evidence: 'unknown', calculation: 'not_verified', public_by_cutoff: 'unknown' } },
}

function sse(type: ChatSseEvent['type'], seq: number, payload: Record<string, unknown> = {}): ChatSseEvent {
  return { type, seq, thread_id: 'T1', run_id: 'run-1', turn_id: 'u1', ...payload }
}

function streamEvent(event: ChatSseEvent, threadId = 'T1'): ChatSessionAction {
  return { type: 'stream.event', threadId, event }
}

function run(state: ChatSessionState, actions: ReadonlyArray<ChatSessionAction>): ChatSessionState {
  return actions.reduce(reduceChatSession, state)
}

function loaded(gen: number, messages: ReadonlyArray<ChatMessage>, activeRun: { runId: string; turnId: string } | null = null, runs: ReadonlyArray<RunStatus> = []): ChatSessionAction {
  return { type: 'history.loaded', threadId: 'T1', gen, messages, activeRun, runs }
}

// A load as the server builds it: active_run is the oldest run in flight.
function read(gen: number, messages: ReadonlyArray<ChatMessage>, runs: ReadonlyArray<RunStatus>, threadId = 'T1'): ChatSessionAction {
  const active = runs.find((entry) => entry.status === 'in_flight')
  return { type: 'history.loaded', threadId, gen, messages, activeRun: active?.run ?? null, runs }
}

const R1 = { runId: 'run-1', turnId: 'u1' }

const STREAM_TO_TEXT: ReadonlyArray<ChatSessionAction> = [
  streamEvent(sse('turn.started', 1)),
  streamEvent(sse('block.began', 2, { block_id: 'b1', kind: 'rich_text' })),
  streamEvent(sse('block.delta', 3, { block_id: 'b1', delta: { segment: { type: 'text', text: "NVIDIA's revenue rose" } } })),
  streamEvent(sse('block.completed', 4, { block_id: 'b1', content_hash: 'h1' })),
]

function streamingT1(): ChatSessionState {
  return run(INITIAL_CHAT_SESSION, [
    { type: 'thread.opened', threadId: 'T1' },
    loaded(1, []),
    { type: 'ask.started', turn: TURN },
    { type: 'message.persisted', threadId: 'T1', message: U1 },
    ...STREAM_TO_TEXT,
  ])
}

function completedT1(payload: Record<string, unknown> = { message_id: 'a1', message: A1_SEALED }): ChatSessionState {
  return reduceChatSession(streamingT1(), streamEvent(sse('turn.completed', 5, payload)))
}

function streamedText(turn: TurnState): string {
  if (!('stream' in turn)) return ''
  return turn.stream.block_order
    .map((id) => turn.stream.blocks_by_id.get(id) as StreamingRichTextBlock)
    .flatMap((block) => block.segments.map((segment) => (segment.type === 'text' ? segment.text : '')))
    .join('')
}

const ids = (state: ChatSessionState) => selectThreadView(state).messages.map((m) => m.message_id)

test('a full turn hands off on its completion in one state, with no history load', () => {
  const handedOff = completedT1()
  assert.equal(handedOff.turn.phase, 'idle')
  assert.deepEqual(ids(handedOff), ['u1', 'a1'])
  assert.deepEqual(selectThreadView(handedOff).messages[1], A1_SEALED)
  assert.equal(handedOff.sealedTurns, 1)
  assert.equal(handedOff.history.requested, 1)
  assert.equal(selectThreadView(handedOff).needsLoad, null)
  assert.equal(selectThreadView(handedOff).canAsk, true)
})

test('a replayed completion after the hand-off returns the same reference', () => {
  const handedOff = completedT1()
  assert.equal(reduceChatSession(handedOff, streamEvent(sse('turn.completed', 5, { message_id: 'a1', message: A1_SEALED }))), handedOff)
})

test('a load in flight at the hand-off neither drops nor duplicates the answer', () => {
  const handedOff = run(INITIAL_CHAT_SESSION, [
    { type: 'thread.opened', threadId: 'T1' },
    loaded(1, []),
    { type: 'ask.started', turn: TURN },
    { type: 'message.persisted', threadId: 'T1', message: U1 },
    { type: 'history.requested' },
    ...STREAM_TO_TEXT,
    streamEvent(sse('turn.completed', 5, { message_id: 'a1', message: A1_SEALED })),
  ])
  assert.deepEqual(ids(handedOff), ['u1', 'a1'])

  const withoutAnswer = reduceChatSession(handedOff, loaded(2, [U1]))
  assert.deepEqual(ids(withoutAnswer), ['u1', 'a1'])

  const withAnswer = reduceChatSession(handedOff, loaded(2, [U1, A1_SEALED], R1))
  assert.deepEqual(ids(withAnswer), ['u1', 'a1'])
  assert.deepEqual(withAnswer.history.local, [])

  // Read while the run streamed, so it still reports that run: it is not adopted again.
  for (const stale of [withAnswer, reduceChatSession(handedOff, loaded(2, [U1], R1))]) {
    assert.deepEqual([stale.turn.phase, selectThreadView(stale).canAsk, wantedStream(stale), ids(stale)], ['idle', true, null, ['u1', 'a1']])
  }
})

test('a completion without a valid sealed message fails with Reload thread and loads the thread in the same state', () => {
  const failed = completedT1({ message_id: 'a1' })
  assert.equal(failed.turn.phase, 'failed')
  assert.deepEqual(
    failed.turn.phase === 'failed' ? [failed.turn.recovery, failed.turn.error] : null,
    ['reload_thread', "Couldn't show the saved copy of this answer."],
  )
  assert.equal(streamedText(failed.turn), "NVIDIA's revenue rose")
  assert.deepEqual(ids(failed), ['u1'])
  assert.equal(failed.sealedTurns, 0)
  assert.deepEqual(selectThreadView(failed).needsLoad, { threadId: 'T1', gen: 2 })
  assert.equal(reduceChatSession(failed, { type: 'turn.retried', runId: 'run-2' }), failed)
})

const answerShown = (state: ChatSessionState) =>
  [streamedText(state.turn) === "NVIDIA's revenue rose", ids(state).includes('a1')]

test('Reload thread keeps the streamed answer until the load that has it hands off in one state', () => {
  const reloading = completedT1({ message_id: 'a1' })
  assert.deepEqual(answerShown(reloading), [true, false])
  assert.equal(reloading.turn.phase === 'failed' ? reloading.turn.recovery : null, 'reload_thread')

  const handedOff = reduceChatSession(reloading, loaded(2, [U1, A1_SEALED]))
  assert.equal(handedOff.turn.phase, 'idle')
  assert.deepEqual(answerShown(handedOff), [false, true])
  assert.deepEqual(ids(handedOff), ['u1', 'a1'])
  assert.equal(handedOff.sealedTurns, 1)
})

test('a failed reload keeps the streamed answer and Reload thread, and says the load failed', () => {
  const reloading = completedT1({ message_id: 'a1' })
  const failedLoad = reduceChatSession(reloading, { type: 'history.failed', threadId: 'T1', gen: 2, message: 'HTTP 503' })
  assert.deepEqual(answerShown(failedLoad), [true, false])
  assert.deepEqual(
    failedLoad.turn.phase === 'failed' ? [failedLoad.turn.recovery, failedLoad.turn.error] : null,
    ['reload_thread', "Couldn't load the saved copy of this answer."],
  )
  assert.equal(selectThreadView(failedLoad).needsLoad, null)
  assert.deepEqual(selectThreadView(reduceChatSession(failedLoad, { type: 'history.requested' })).needsLoad, { threadId: 'T1', gen: 3 })
})

test('a reload whose thread lacks the answer keeps the streamed answer and Reload thread', () => {
  const lacking = reduceChatSession(completedT1({ message_id: 'a1' }), loaded(2, [U1]))
  assert.deepEqual(answerShown(lacking), [true, false])
  assert.deepEqual(
    lacking.turn.phase === 'failed' ? [lacking.turn.recovery, lacking.turn.error] : null,
    ['reload_thread', "The saved copy of this answer isn't in the thread yet."],
  )
  assert.equal(lacking.sealedTurns, 0)
})

test('canAsk is true only when no turn is in flight and the opening load has settled', () => {
  const opened = reduceChatSession(INITIAL_CHAT_SESSION, { type: 'thread.opened', threadId: 'T1' })
  const ready = reduceChatSession(opened, loaded(1, []))
  const openFailed = reduceChatSession(opened, { type: 'history.failed', threadId: 'T1', gen: 1, message: 'HTTP 503' })
  const persisting = reduceChatSession(ready, { type: 'ask.started', turn: TURN })
  const streaming = streamingT1()
  const dropped = reduceChatSession(streaming, { type: 'stream.dropped', threadId: 'T1', runId: 'run-1' })
  const errored = reduceChatSession(streaming, streamEvent(sse('turn.error', 5, { error: 'upstream_500' })))
  const unsealed = reduceChatSession(completedT1({ message_id: 'a1' }), loaded(2, [U1]))
  const unverified = reduceChatSession(streaming, streamEvent(sse('turn.completed', 5, {
    unverified: { persisted: false, failures: [], blocks: [] },
  })))
  const notSent = reduceChatSession(persisting, { type: 'ask.failed', error: 'HTTP 500' })

  const table = { opened, ready, openFailed, persisting, streaming, dropped, errored, unsealed, unverified, notSent }
  assert.deepEqual(
    Object.fromEntries(Object.entries(table).map(([name, state]) => [name, [state.turn.phase, selectThreadView(state).canAsk]])),
    {
      opened: ['idle', false],
      ready: ['idle', true],
      openFailed: ['idle', true],
      persisting: ['persisting', false],
      streaming: ['streaming', false],
      dropped: ['streaming', false],
      errored: ['failed', true],
      unsealed: ['failed', true],
      unverified: ['unverified', true],
      notSent: ['not_sent', true],
    },
  )
  assert.equal(reduceChatSession(opened, { type: 'ask.started', turn: TURN }), opened)
  assert.equal(reduceChatSession(persisting, { type: 'ask.started', turn: { ...TURN, runId: 'run-2' } }), persisting)
})

test('stream events for another run or another thread return the same reference', () => {
  const streaming = streamingT1()
  const delta = { block_id: 'b1', delta: { segment: { type: 'text', text: ' late' } } }
  assert.equal(reduceChatSession(streaming, streamEvent(sse('block.delta', 9, { ...delta, run_id: 'other' }))), streaming)
  assert.equal(reduceChatSession(streaming, streamEvent(sse('block.delta', 9, delta), 'T2')), streaming)
  assert.equal(reduceChatSession(streaming, { type: 'stream.dropped', threadId: 'T1', runId: 'other' }), streaming)
  assert.equal(reduceChatSession(streaming, { type: 'stream.dropped', threadId: 'T2', runId: 'run-1' }), streaming)
  const sameRun = run(streaming, [
    streamEvent(sse('block.began', 9, { block_id: 'b2', kind: 'rich_text' })),
    streamEvent(sse('block.delta', 10, { ...delta, block_id: 'b2' })),
  ])
  assert.equal(streamedText(sameRun.turn), "NVIDIA's revenue rose late")
})

test('opening the same thread is a no-op and opening another starts a fresh session', () => {
  const opened = reduceChatSession(INITIAL_CHAT_SESSION, { type: 'thread.opened', threadId: 'T1' })
  assert.equal(reduceChatSession(opened, { type: 'thread.opened', threadId: 'T1' }), opened)

  const t2 = reduceChatSession(streamingT1(), { type: 'thread.opened', threadId: 'T2' })
  assert.equal(t2.threadId, 'T2')
  assert.equal(t2.turn.phase, 'idle')
  assert.deepEqual(t2.history.loaded, { kind: 'loading' })
  assert.equal(t2.history.requested, 1)
  assert.deepEqual(selectThreadView(t2).needsLoad, { threadId: 'T2', gen: 1 })
  assert.equal(selectThreadView(t2).history, 'loading')
  assert.equal(reduceChatSession(t2, loaded(1, [U1])), t2)
})

test('a GET that started before the POST landed does not drop the posted user message', () => {
  const state = run(INITIAL_CHAT_SESSION, [
    { type: 'thread.opened', threadId: 'T1' },
    loaded(1, []),
    { type: 'ask.started', turn: TURN },
    { type: 'history.requested' },
    { type: 'message.persisted', threadId: 'T1', message: U1 },
    loaded(2, []),
  ])
  assert.deepEqual(ids(state), ['u1'])
  assert.equal(selectThreadView(state).firstQuestion, 'Analyze NVDA')
})

test('Retry after a turn.error starts the same question as a fresh run, never the failed one', () => {
  const failed = reduceChatSession(streamingT1(), streamEvent(sse('turn.error', 5, { error: 'upstream_500' })))
  assert.deepEqual(failed.turn.phase === 'failed' ? [failed.turn.recovery, failed.turn.error] : null, ['retry_run', 'Stream error: upstream_500'])
  assert.equal(wantedStream(failed), null)

  const retried = reduceChatSession(failed, { type: 'turn.retried', runId: 'run-2' })
  assert.deepEqual(wantedStream(retried), { key: 'T1|run-2|start|0', threadId: 'T1', run: { runId: 'run-2', turnId: 'u1' }, attach: false, userIntent: 'Analyze NVDA' })
  assert.equal(retried.turn.phase === 'streaming' ? retried.turn.stream.block_order.length : -1, 0)
  assert.equal(selectThreadView(retried).canAsk, false)
  assert.deepEqual(retried.endedRuns, ['run-1'])
})

test('a server turn.error fails the turn with its reason', () => {
  const failed = reduceChatSession(streamingT1(), streamEvent(sse('turn.error', 5, { error: 'upstream_500' })))
  assert.equal(failed.turn.phase === 'failed' ? failed.turn.error : null, 'Stream error: upstream_500')
  assert.equal(streamedText(failed.turn), "NVIDIA's revenue rose")
})

test('an unverified completion requests no history load', () => {
  const streaming = streamingT1()
  const unverified = reduceChatSession(streaming, streamEvent(sse('turn.completed', 5, {
    unverified: { persisted: false, failures: [{ reason_code: 'missing_fact_ref' }], blocks: [] },
  })))
  assert.equal(unverified.turn.phase, 'unverified')
  assert.equal(unverified.history.requested, 1)
  assert.equal(selectThreadView(unverified).needsLoad, null)
})

test('ask first: the created thread starts ready and empty with no load', () => {
  const state = run(INITIAL_CHAT_SESSION, [
    { type: 'ask.started', turn: TURN },
    { type: 'thread.created', threadId: 'T1' },
  ])
  const view = selectThreadView(state)
  assert.equal(view.threadId, 'T1')
  assert.equal(view.history, 'ready')
  assert.equal(view.listMounted, true)
  assert.equal(view.needsLoad, null)
  assert.equal(view.firstQuestion, 'Analyze NVDA')
  assert.equal(reduceChatSession(state, { type: 'thread.opened', threadId: 'T1' }), state)
})

test('a history load that returns the user message before the POST response shows it once', () => {
  const state = run(INITIAL_CHAT_SESSION, [
    { type: 'thread.opened', threadId: 'T1' },
    loaded(1, []),
    { type: 'ask.started', turn: TURN },
    { type: 'history.requested' },
    loaded(2, [U1]),
    { type: 'message.persisted', threadId: 'T1', message: U1 },
  ])
  assert.deepEqual(ids(state), ['u1'])
  assert.equal(state.turn.phase, 'streaming')
})

test('the own ask streams without attach, carrying its question, and blocks render live', () => {
  const streaming = streamingT1()
  assert.deepEqual(streaming.turn.phase === 'streaming' ? [streaming.turn.run, streaming.turn.origin, streaming.turn.link] : null, [R1, OWN, LINK])
  assert.deepEqual(wantedStream(streaming), { key: 'T1|run-1|start|0', threadId: 'T1', run: R1, attach: false, userIntent: 'Analyze NVDA' })
  assert.equal(wantedStream(completedT1()), null)
})

const opened = () => reduceChatSession(INITIAL_CHAT_SESSION, { type: 'thread.opened', threadId: 'T1' })
const OWN = { kind: 'own', input: { userIntent: 'Analyze NVDA' } }
const ADOPTED = { kind: 'adopted' }
const LINK = { kind: 'open', attach: false, attempt: 0, reached: true, drops: 0, seenSeq: 4 }
const ATTACHED = { kind: 'open', attach: true, attempt: 0, reached: false, drops: 0, seenSeq: 0 }

test('a load that reports an active run adopts it: attached, Send disabled, one attach stream', () => {
  const adopted = reduceChatSession(opened(), loaded(1, [U1], R1))
  assert.deepEqual(
    adopted.turn.phase === 'streaming' ? [adopted.turn.run, adopted.turn.origin, adopted.turn.link, adopted.turn.stream.turn_status] : null,
    [R1, ADOPTED, ATTACHED, 'idle'],
  )
  assert.deepEqual(ids(adopted), ['u1'])
  assert.equal(selectThreadView(adopted).canAsk, false)
  assert.deepEqual(wantedStream(adopted), { key: 'T1|run-1|attach|0', threadId: 'T1', run: R1, attach: true })

  const handedOff = run(adopted, [
    streamEvent(sse('turn.started', 1)),
    streamEvent(sse('turn.completed', 2, { message_id: 'a1', message: A1_SEALED })),
  ])
  assert.equal(handedOff.turn.phase, 'idle')
  assert.deepEqual(ids(handedOff), ['u1', 'a1'])
  assert.equal(selectThreadView(handedOff).needsLoad, null)
  assert.equal(selectThreadView(handedOff).canAsk, true)
})

test('an adopted run whose answer the load already holds shows it once after the hand-off', () => {
  const adopted = reduceChatSession(opened(), loaded(1, [U1, A1_SEALED], R1))
  const handedOff = reduceChatSession(adopted, streamEvent(sse('turn.completed', 2, { message_id: 'a1', message: A1_SEALED })))
  assert.deepEqual(ids(handedOff), ['u1', 'a1'])
})

test('an unsealed completion naming an answer the thread already holds hands off with no load', () => {
  const adopted = reduceChatSession(opened(), loaded(1, [U1, A1_SEALED], R1))
  const handedOff = run(adopted, [...STREAM_TO_TEXT, streamEvent(sse('turn.completed', 5, { message_id: 'a1' }))])
  assert.deepEqual([handedOff.turn.phase, ids(handedOff), handedOff.sealedTurns, selectThreadView(handedOff).needsLoad], ['idle', ['u1', 'a1'], 1, null])
})

test('a load ignores the active run while the session streams its own ask', () => {
  const streaming = run(streamingT1(), [{ type: 'history.requested' }])
  assert.equal(reduceChatSession(streaming, loaded(2, [U1], { runId: 'run-9', turnId: 'u9' })).turn, streaming.turn)
})

const drop: ChatSessionAction = { type: 'stream.dropped', threadId: 'T1', runId: 'run-1' }
const linkOf = (state: ChatSessionState) => (state.turn.phase === 'streaming' ? state.turn.link : null)
const adoptedT1 = () => reduceChatSession(opened(), loaded(1, [U1], R1))
const IN_FLIGHT: RunStatus = { run: R1, status: 'in_flight' }
const U0 = message('u0', 'user', 'What did the Fed do?')
const A0 = message('a0', 'assistant', 'The Fed held rates')

function unreachedT1(): ChatSessionState {
  return run(INITIAL_CHAT_SESSION, [
    { type: 'thread.opened', threadId: 'T1' },
    loaded(1, []),
    { type: 'ask.started', turn: TURN },
    { type: 'message.persisted', threadId: 'T1', message: U1 },
  ])
}

test('an own stream that never reached the server reopens the same ask without a load, and goes offline past its budget', () => {
  const reopened = reduceChatSession(unreachedT1(), drop)
  assert.deepEqual(linkOf(reopened), { ...LINK, attempt: 1, reached: false, drops: 1, seenSeq: 0 })
  assert.equal(selectThreadView(reopened).needsLoad, null)
  assert.equal(selectThreadView(reopened).canAsk, false)
  assert.deepEqual(wantedStream(reopened), { key: 'T1|run-1|start|1', threadId: 'T1', run: R1, attach: false, userIntent: 'Analyze NVDA' })

  const offline = run(unreachedT1(), [drop, drop, drop, drop])
  assert.deepEqual(linkOf(offline), { ...LINK, kind: 'offline', attempt: 3, reached: false, drops: 4, seenSeq: 0 })
  assert.equal(wantedStream(offline), null)
  assert.equal(selectThreadView(offline).needsLoad, null)
})

test('an own stream that answered and dropped never reopens without attach: the load it requests decides', () => {
  for (const reached of [
    run(unreachedT1(), [{ type: 'stream.opened', threadId: 'T1', runId: 'run-1' }, drop]),
    reduceChatSession(streamingT1(), drop),
  ]) {
    assert.deepEqual([linkOf(reached)?.kind, linkOf(reached)?.attach], ['reconnecting', true])
    assert.deepEqual(selectThreadView(reached).needsLoad, { threadId: 'T1', gen: 2 })
    assert.equal(wantedStream(reached), null)
    assert.equal(selectThreadView(reached).canAsk, false)
  }
})

test('a reconnecting own run follows the status the load reports for it, never the order of the messages', () => {
  const reconnecting = reduceChatSession(streamingT1(), drop)

  const attached = reduceChatSession(reconnecting, read(2, [U0, U1, A0], [{ run: { runId: 'run-0', turnId: 'u0' }, status: 'completed', messageId: 'a0' }, IN_FLIGHT]))
  assert.deepEqual(wantedStream(attached), { key: 'T1|run-1|attach|1', threadId: 'T1', run: R1, attach: true })
  assert.deepEqual([ids(attached), selectThreadView(attached).canAsk], [['u0', 'u1', 'a0'], false])

  const answered = reduceChatSession(reconnecting, read(2, [U1, A1_SEALED], [{ run: R1, status: 'completed', messageId: 'a1' }]))
  assert.deepEqual([answered.turn.phase, ids(answered), answered.sealedTurns, selectThreadView(answered).canAsk], ['idle', ['u1', 'a1'], 1, true])

  const notYetRead = reduceChatSession(reconnecting, read(2, [U1], [{ run: R1, status: 'completed', messageId: 'a1' }]))
  assert.deepEqual(notYetRead.turn.phase === 'failed' && notYetRead.turn.recovery === 'reload_thread' ? notYetRead.turn.messageId : null, 'a1')
  assert.deepEqual(selectThreadView(notYetRead).needsLoad, { threadId: 'T1', gen: 3 })
  assert.deepEqual(ids(reduceChatSession(notYetRead, read(3, [U1, A1_SEALED], []))), ['u1', 'a1'])

  const failed = reduceChatSession(reconnecting, read(2, [U1], [{ run: R1, status: 'failed' }]))
  assert.deepEqual(failed.turn.phase === 'failed' ? [failed.turn.recovery, failed.turn.error] : null, ['retry_run', "The analyst couldn't answer this question."])

  // Restarted, another instance, or past retention.
  for (const messages of [[U1, A1_SEALED], [U1]]) {
    const unknown = reduceChatSession(reconnecting, read(2, messages, []))
    assert.deepEqual([unknown.turn.phase, ids(unknown), unknown.sealedTurns, selectThreadView(unknown).canAsk, wantedStream(unknown)], ['idle', messages.map((m) => m.message_id), 0, true, null])
  }
})

test('a dropped adopted stream asks the server again: reattach while the run is in flight, settle when it is gone', () => {
  const reconnecting = reduceChatSession(adoptedT1(), drop)
  assert.deepEqual([linkOf(reconnecting)?.kind, linkOf(reconnecting)?.drops], ['reconnecting', 1])
  assert.deepEqual(selectThreadView(reconnecting).needsLoad, { threadId: 'T1', gen: 2 })
  assert.equal(selectThreadView(reconnecting).canAsk, false)
  assert.equal(wantedStream(reconnecting), null)

  const reattached = reduceChatSession(reconnecting, read(2, [U1], [IN_FLIGHT]))
  assert.deepEqual(wantedStream(reattached), { key: 'T1|run-1|attach|1', threadId: 'T1', run: R1, attach: true })

  const settled = reduceChatSession(reconnecting, read(2, [U1, A1_SEALED], [{ run: R1, status: 'completed', messageId: 'a1' }]))
  assert.equal(settled.turn.phase, 'idle')
  assert.deepEqual(ids(settled), ['u1', 'a1'])
  assert.equal(selectThreadView(settled).canAsk, true)

  const failed = reduceChatSession(reconnecting, read(2, [U1], [{ run: R1, status: 'failed' }]))
  assert.deepEqual(failed.turn.phase === 'failed' ? failed.turn.recovery : null, 'none')
})

test('three failed reattaches go offline, and Reconnect asks the server again with a fresh budget', () => {
  const thirdReattach = run(adoptedT1(), [drop, read(2, [U1], [IN_FLIGHT]), drop, read(3, [U1], [IN_FLIGHT]), drop, read(4, [U1], [IN_FLIGHT])])
  assert.deepEqual([linkOf(thirdReattach)?.kind, linkOf(thirdReattach)?.attempt, linkOf(thirdReattach)?.drops], ['open', 3, 3])

  const offline = reduceChatSession(thirdReattach, drop)
  assert.equal(linkOf(offline)?.kind, 'offline')
  assert.equal(selectThreadView(offline).needsLoad, null)
  assert.equal(selectThreadView(offline).canAsk, false)
  assert.equal(wantedStream(offline), null)

  const reconnect = reduceChatSession(offline, { type: 'link.reconnected' })
  assert.deepEqual([linkOf(reconnect)?.kind, linkOf(reconnect)?.drops], ['reconnecting', 0])
  assert.deepEqual(selectThreadView(reconnect).needsLoad, { threadId: 'T1', gen: 5 })
  assert.deepEqual(wantedStream(reduceChatSession(reconnect, read(5, [U1], [IN_FLIGHT])))?.key, 'T1|run-1|attach|4')
})

test('only an event past the highest seq seen refills the drop budget; replays from seq 1 do not', () => {
  const replayed = (state: ChatSessionState, gen: number) => run(state, [streamEvent(sse('turn.started', 1)), drop, read(gen, [U1], [IN_FLIGHT])])
  let state = streamingT1()
  for (let gen = 2; gen <= 4; gen++) state = replayed(state, gen)
  assert.deepEqual([linkOf(state)?.kind, linkOf(state)?.drops], ['open', 3])
  assert.equal(linkOf(reduceChatSession(state, drop))?.kind, 'offline')

  const progressed = reduceChatSession(state, streamEvent(sse('tool.started', 5, { tool_call_id: 't1', tool_name: 'get_quote' })))
  assert.deepEqual([linkOf(progressed)?.drops, linkOf(progressed)?.seenSeq], [0, 5])
})

test('a failed load while reconnecting goes offline', () => {
  const offline = run(adoptedT1(), [drop, { type: 'history.failed', threadId: 'T1', gen: 2, message: 'HTTP 502' }])
  assert.equal(linkOf(offline)?.kind, 'offline')
  assert.equal(selectThreadView(offline).canAsk, false)
})

test('an unsealed completion without message_id ignores a load that was in flight, and the load it requests settles it', () => {
  const inFlight = run(streamingT1(), [{ type: 'history.requested' }])
  const failed = reduceChatSession(inFlight, streamEvent(sse('turn.completed', 5, {})))
  assert.deepEqual(
    failed.turn.phase === 'failed' && failed.turn.recovery === 'reload_thread' ? [failed.turn.messageId, failed.history.requested] : null,
    [null, 3],
  )
  assert.equal(reduceChatSession(failed, loaded(2, [U1])), failed)

  const settled = reduceChatSession(failed, loaded(3, [U1, A1_SEALED]))
  assert.equal(settled.turn.phase, 'idle')
  assert.deepEqual(ids(settled), ['u1', 'a1'])
})

test('a settled failed turn adopts another active run the load reports', () => {
  const adopted = reduceChatSession(completedT1({ message_id: 'a1' }), loaded(2, [U1, A1_SEALED], { runId: 'run-2', turnId: 'u2' }))
  assert.deepEqual(
    adopted.turn.phase === 'streaming' ? [adopted.turn.run, adopted.turn.origin, adopted.turn.link] : null,
    [{ runId: 'run-2', turnId: 'u2' }, ADOPTED, ATTACHED],
  )
  assert.deepEqual(ids(adopted), ['u1', 'a1'])
})

const toT2: ChatSessionAction = { type: 'thread.opened', threadId: 'T2' }
const toT1: ChatSessionAction = { type: 'thread.opened', threadId: 'T1' }
const RELEASED = (reached: boolean) => ({ threadId: 'T1', run: R1, input: { userIntent: 'Analyze NVDA' }, reached })

test('leaving a thread mid-run releases the own run, and coming back reconciles it by its status', () => {
  assert.deepEqual(run(unreachedT1(), [toT2]).released, [RELEASED(false)])
  const away = run(streamingT1(), [toT2])
  assert.deepEqual(away.released, [RELEASED(true)])

  const back = reduceChatSession(away, toT1)
  assert.equal(selectThreadView(back).canAsk, false)
  const attached = reduceChatSession(back, read(1, [U1], [IN_FLIGHT]))
  assert.deepEqual(wantedStream(attached), { key: 'T1|run-1|attach|0', threadId: 'T1', run: R1, attach: true })
  assert.deepEqual([attached.turn.phase === 'streaming' ? attached.turn.origin : null, attached.released], [OWN, []])

  const answered = reduceChatSession(back, read(1, [U1, A1_SEALED], [{ run: R1, status: 'completed', messageId: 'a1' }]))
  assert.deepEqual([answered.turn.phase, ids(answered), answered.released, selectThreadView(answered).canAsk], ['idle', ['u1', 'a1'], [], true])

  const notYetRead = reduceChatSession(back, read(1, [U1], [{ run: R1, status: 'completed', messageId: 'a1' }]))
  assert.deepEqual([notYetRead.released, selectThreadView(notYetRead).needsLoad], [[], { threadId: 'T1', gen: 2 }])

  const failed = reduceChatSession(back, read(1, [U1], [{ run: R1, status: 'failed' }]))
  assert.deepEqual(failed.turn.phase === 'failed' ? [failed.turn.recovery, failed.turn.origin] : null, ['retry_run', OWN])
  assert.equal(wantedStream(reduceChatSession(failed, { type: 'turn.retried', runId: 'run-2' }))?.key, 'T1|run-2|start|0')

  const unknown = reduceChatSession(back, read(1, [U1], []))
  assert.deepEqual([unknown.turn.phase, unknown.released, selectThreadView(unknown).canAsk], ['idle', [], true])
})

test('a run that completed with no saved message, reported for a reconnecting or a released own run, is attached to replay its outcome', () => {
  const unsaved: RunStatus = { run: R1, status: 'completed', messageId: null }
  const reconnecting = reduceChatSession(streamingT1(), drop)
  const back = run(streamingT1(), [toT2, toT1])
  for (const state of [reduceChatSession(reconnecting, read(2, [U1], [unsaved])), reduceChatSession(back, read(1, [U1], [unsaved]))]) {
    assert.equal(wantedStream(state)?.attach, true)
    assert.deepEqual([state.turn.phase, state.turn.phase === 'streaming' ? state.turn.origin : null, state.sealedTurns, state.released], ['streaming', OWN, 0, []])
    assert.equal(selectThreadView(state).canAsk, false)

    const shown = reduceChatSession(state, streamEvent(sse('turn.completed', 9, {
      unverified: { persisted: false, failures: [{ reason_code: 'missing_fact_ref' }], blocks: A1.blocks },
    })))
    assert.deepEqual([shown.turn.phase, shown.sealedTurns, selectThreadView(shown).canAsk], ['unverified', 0, true])
  }
})

test('a released run whose stream has not reached the server is sent again when a load lacks it, with Send held', () => {
  const back = run(unreachedT1(), [toT2, toT1, read(1, [U1], [])])
  assert.deepEqual([back.released, wantedStream(back)?.key, selectThreadView(back).canAsk], [[], 'T1|run-1|start|0', false])
})

test('a released run that reaches the server while a load is in flight replaces that load, which may predate it', () => {
  const loading = run(unreachedT1(), [toT2, toT1])
  const reached = reduceChatSession(loading, { type: 'released.reached', threadId: 'T1', runId: 'run-1' })
  assert.deepEqual(selectThreadView(reached).needsLoad, { threadId: 'T1', gen: 2 })
  assert.equal(reduceChatSession(reached, read(1, [U1], [])), reached)
})

test('a released run a load lacks is sent again before another run the load lists, which is attached when it ends', () => {
  const R9 = { runId: 'run-9', turnId: 'u9' }
  const back = run(unreachedT1(), [toT2, toT1, read(1, [U1], [{ run: R9, status: 'in_flight' }])])
  assert.deepEqual([wantedStream(back)?.key, back.released, selectThreadView(back).canAsk], ['T1|run-1|start|0', [], false])

  const ended = reduceChatSession(back, streamEvent(sse('turn.completed', 1, { message_id: 'a1', message: A1_SEALED })))
  assert.deepEqual([wantedStream(ended)?.key, selectThreadView(ended).canAsk], ['T1|run-9|attach|0', false])
})


test('when an own run fails while another run is in flight, the session attaches to that run with Send held', () => {
  const R2 = { runId: 'run-2', turnId: 'u2' }
  const listed = run(streamingT1(), [
    { type: 'history.requested' },
    read(2, [U1], [{ run: R1, status: 'in_flight' }, { run: R2, status: 'in_flight' }]),
  ])
  assert.deepEqual(listed.turn.phase === 'streaming' ? listed.turn.run : null, R1)

  const failed = reduceChatSession(listed, streamEvent(sse('turn.error', 5, { error_code: 'runner_failed', message: 'boom' })))
  assert.deepEqual(wantedStream(failed), { key: 'T1|run-2|attach|0', threadId: 'T1', run: R2, attach: true })
  assert.equal(selectThreadView(failed).canAsk, false)
})

test('when a followed run ends while the last read listed another in flight, the session attaches to it, and a failed load keeps Send held', () => {
  const U2 = message('u2', 'user', 'Compare with AMD')
  const R2 = { runId: 'run-2', turnId: 'u2' }
  const adopted = reduceChatSession(opened(), read(1, [U1, U2], [{ run: R1, status: 'in_flight' }, { run: R2, status: 'in_flight' }]))
  const handedOff = run(adopted, [
    streamEvent(sse('turn.started', 1)),
    streamEvent(sse('turn.completed', 2, { message_id: 'a1', message: A1_SEALED })),
  ])
  assert.deepEqual(wantedStream(handedOff), { key: 'T1|run-2|attach|0', threadId: 'T1', run: R2, attach: true })

  const failedLoad = reduceChatSession(handedOff, { type: 'history.failed', threadId: 'T1', gen: 2, message: 'HTTP 503' })
  assert.deepEqual([failedLoad.turn.phase, selectThreadView(failedLoad).canAsk], ['streaming', false])
})

test('an own run that went offline before reaching the server is sent again when its thread is opened again', () => {
  const offline = run(unreachedT1(), [drop, drop, drop, drop])
  const back = run(offline, [toT2, toT1, read(1, [U1], [])])
  assert.deepEqual(wantedStream(back), { key: 'T1|run-1|start|0', threadId: 'T1', run: R1, attach: false, userIntent: 'Analyze NVDA' })
  assert.equal(selectThreadView(back).canAsk, false)
})

test('a load that holds the answer of the run the session streams hands off at once, the answer once', () => {
  const reloading = run(streamingT1(), [{ type: 'history.requested' }])
  const handedOff = reduceChatSession(reloading, read(2, [U1, A1_SEALED], [{ run: R1, status: 'completed', messageId: 'a1' }]))
  assert.deepEqual([handedOff.turn.phase, ids(handedOff), handedOff.sealedTurns, wantedStream(handedOff)], ['idle', ['u1', 'a1'], 1, null])
})

test('a run released on the thread on screen, its question saved after the user came back, is followed at once with Send held', () => {
  const back = run(INITIAL_CHAT_SESSION, [
    { type: 'thread.opened', threadId: 'T1' },
    loaded(1, []),
    { type: 'ask.started', turn: TURN },
    toT2,
    toT1,
    read(1, [], []),
  ])
  assert.equal(selectThreadView(back).canAsk, true)
  const released = reduceChatSession(back, { type: 'run.released', threadId: 'T1', run: R1, input: { userIntent: 'Analyze NVDA' } })
  assert.deepEqual([wantedStream(released)?.key, released.released, selectThreadView(released).canAsk, selectThreadView(released).needsLoad], ['T1|run-1|start|0', [], false, { threadId: 'T1', gen: 2 }])
})
