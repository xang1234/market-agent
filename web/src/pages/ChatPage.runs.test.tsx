import './installDomBeforeReact.ts'

import assert from 'node:assert/strict'
import test from 'node:test'

import { act } from 'react'

import {
  USER_ID,
  ANSWER,
  FakeEventSource,
  chatMessage,
  sealedAnswer,
  answerMessage,
  FakeServer,
  renderChat,
  occurrences,
  streamAnswer,
  complete,
  consecutive,
  HISTORY_T1,
  SEALED_TEXT,
  STILL_ANSWERING,
  UUID_PATTERN,
  streamParams,
  threadRead,
  type Harness,
  type RunJson,
} from './chatPageHarness.tsx'

async function dropStream(h: Harness, source: FakeEventSource) {
  await act(async () => source.onerror?.())
  await h.flush()
}

const runOf = (source: FakeEventSource) => ({ run_id: source.params.get('run_id')!, turn_id: source.params.get('turn_id')! })

test('an own stream that opened and dropped, whose run the server no longer lists, shows the thread as it is with no stream that could start it again', async () => {
  const server = new FakeServer()
  server.history = (id) => threadRead(server.posted.size === 0 ? [] : [server.postedUser(id), sealedAnswer(id)])
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    const own = FakeEventSource.instances[0]
    await act(async () => own.open())
    await dropStream(h, own)

    assert.equal(FakeEventSource.instances.length, 1)
    assert.equal(server.gets(HISTORY_T1), 2)
    assert.equal(occurrences(h.text(), ANSWER), 1)
    assert.equal(h.query('[data-role="assistant"]')?.textContent, SEALED_TEXT)
    assert.equal(h.query('[data-testid="streaming-turn"]'), null)
    assert.doesNotMatch(h.text(), /didn't answer/)
    assert.equal(h.button('Send').disabled, false)
  } finally {
    await h.cleanup()
  }
})

test("an own run listed in flight after another tab's answered run is attached, and that tab's answer is never taken as ours", async () => {
  const server = new FakeServer()
  let reads = 0
  let own: RunJson | null = null
  server.history = (id) => (++reads === 1
    ? threadRead([])
    : threadRead(
      [chatMessage(id, 'u0', 'user', 'What did the Fed do?'), server.postedUser(id), answerMessage(id, 'a0', 'The Fed held rates')],
      [{ run_id: 'r0', turn_id: 'u0', status: 'completed', message_id: 'a0' }, own!],
    ))
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    const first = FakeEventSource.instances[0]
    own = { ...runOf(first), status: 'in_flight' }
    await act(async () => first.emit('turn.started', 1))
    await dropStream(h, first)

    assert.equal(FakeEventSource.instances.length, 2)
    const attached = FakeEventSource.instances[1]
    assert.deepEqual(streamParams(attached), { ...runOf(first), user_id: USER_ID, attach: '1' })
    assert.equal(server.gets(HISTORY_T1), 2)
    assert.equal(occurrences(h.text(), 'The Fed held rates'), 1)
    assert.match(h.text(), STILL_ANSWERING)
    assert.equal(h.button('Send').disabled, true)

    await streamAnswer(h, attached)
    assert.equal(h.button('Send').disabled, true)
    await complete(h, attached)
    assert.equal(occurrences(h.text(), ANSWER), 1)
    assert.equal(occurrences(h.text(), 'The Fed held rates'), 1)
    assert.equal(h.button('Send').disabled, false)
  } finally {
    await h.cleanup()
  }
})

// A's first connection stalls; the user leaves, comes back and sends B; A's
// released stream then reaches the server, so A queues behind B.
test("Retry on a failed run starts the same question as a fresh run: a new run id, the same turn and question, no attach", async () => {
  const server = new FakeServer()
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    const failed = FakeEventSource.instances[0]
    await act(async () => {
      failed.emit('turn.started', 1)
      failed.emit('turn.error', 2, { error: 'upstream_500' })
    })
    await h.flush()
    assert.match(h.text(), /Stream error: upstream_500/)

    await act(async () => h.button('Retry').click())
    await h.flush()
    assert.equal(FakeEventSource.instances.length, 2)
    const retried = FakeEventSource.instances[1]
    assert.match(retried.params.get('run_id')!, UUID_PATTERN)
    assert.notEqual(retried.params.get('run_id'), failed.params.get('run_id'))
    assert.deepEqual(
      [retried.params.get('turn_id'), retried.params.get('user_intent'), retried.params.get('attach')],
      [failed.params.get('turn_id'), 'Analyze NVDA', null],
    )
    assert.equal(h.button('Send').disabled, true)

    await streamAnswer(h, retried)
    await complete(h, retried)
    assert.equal(occurrences(h.text(), ANSWER), 1)
    assert.equal(h.button('Send').disabled, false)
  } finally {
    await h.cleanup()
  }
})

test('replayed events never refill the drop budget: twelve cycles of a replayed turn.started and a drop end offline after three reattaches', async () => {
  const server = new FakeServer()
  let reads = 0
  let own: RunJson | null = null
  server.history = (id) => (++reads === 1 ? threadRead([]) : threadRead([server.postedUser(id)], [own!]))
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    own = { ...runOf(FakeEventSource.instances[0]), status: 'in_flight' }
    for (let cycle = 0; cycle < 12; cycle++) {
      const source = FakeEventSource.instances.at(-1)!
      if (source.closed) break
      await act(async () => source.emit('turn.started', 1))
      await dropStream(h, source)
    }

    assert.match(h.text(), /Lost the connection to the analyst\./)
    assert.equal(FakeEventSource.instances.length, 4)
    assert.deepEqual(FakeEventSource.instances.slice(1).map((source) => source.params.get('attach')), ['1', '1', '1'])
    assert.equal(server.gets(HISTORY_T1), 4)
    assert.equal(h.button('Send').disabled, true)
  } finally {
    await h.cleanup()
  }
})

test("an own stream's turn.error opens no other stream", async () => {
  const server = new FakeServer()
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    const own = FakeEventSource.instances[0]
    await act(async () => {
      own.emit('turn.started', 1)
      own.emit('turn.error', 2, { error: 'upstream_500' })
    })
    await h.flush()

    assert.equal(FakeEventSource.instances.length, 1)
    assert.equal(own.closed, true)
    assert.equal(server.gets(HISTORY_T1), 1)
    assert.equal(h.button('Send').disabled, false)
  } finally {
    await h.cleanup()
  }
})

// display_unverified: the run's turn.completed carries the answer and names no saved message.
const unverifiedCompletion = (threadId: string) => ({
  unverified: { persisted: false, failures: [{ reason_code: 'missing_fact_ref' }], blocks: chatMessage(threadId, 'x1', 'assistant', ANSWER).blocks },
})

test('an unverified run that completed while its own stream was down is attached, and its answer shows once', async () => {
  const server = new FakeServer()
  let own: RunJson | null = null
  server.history = (id) => threadRead(server.posted.size === 0 ? [] : [server.postedUser(id)], own ? [own] : [])
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    const first = FakeEventSource.instances[0]
    await act(async () => first.open())
    await streamAnswer(h, first)
    own = { ...runOf(first), status: 'completed' }
    await dropStream(h, first)

    assert.equal(FakeEventSource.instances.length, 2)
    const attached = FakeEventSource.instances[1]
    assert.deepEqual(streamParams(attached), { ...runOf(first), user_id: USER_ID, attach: '1' })
    await streamAnswer(h, attached)
    await act(async () => attached.emit('turn.completed', 5, unverifiedCompletion('T1')))
    await h.flush()

    assert.equal(h.query('[data-testid="streaming-turn"]')?.getAttribute('data-turn-status'), 'unverified')
    assert.equal(occurrences(h.text(), ANSWER), 1)
    assert.match(h.text(), /This answer failed verification and was not saved\./)
    assert.equal(server.gets(HISTORY_T1), 2)
    assert.equal(FakeEventSource.instances.length, 2)
    assert.equal(h.button('Send').disabled, false)
  } finally {
    await h.cleanup()
  }
})

// The attach stream replays the run from its first event, one event per task as a browser delivers them.
async function replayAnswer(h: Harness, source: FakeEventSource) {
  await act(async () => source.emit('turn.started', 1))
  await act(async () => source.emit('block.began', 2, { block_id: 'b1', kind: 'rich_text' }))
  await act(async () => source.emit('block.delta', 3, { block_id: 'b1', delta: { segment: { type: 'text', text: ANSWER } } }))
  await act(async () => source.emit('block.completed', 4, { block_id: 'b1', content_hash: 'h1' }))
  await h.flush()
}

async function reattachedOwnRun(server: FakeServer) {
  let own: RunJson | null = null
  server.history = (id) => threadRead(server.posted.size === 0 ? [] : [server.postedUser(id)], own ? [own] : [])
  const h = await renderChat('/chat/T1', server)
  await h.ask('Analyze NVDA')
  const first = FakeEventSource.instances[0]
  await act(async () => first.open())
  await streamAnswer(h, first)
  const streamed = h.frames.length - 1
  own = { ...runOf(first), status: 'in_flight' }
  await dropStream(h, first)
  assert.equal(FakeEventSource.instances.length, 2)
  const attached = FakeEventSource.instances[1]
  assert.equal(attached.params.get('attach'), '1')
  await replayAnswer(h, attached)
  return { h, attached, sinceStreamed: () => h.frames.slice(streamed).map((frame) => occurrences(frame, ANSWER)) }
}

test('an own run keeps its streamed answer on screen in every commit through a drop, the reattach and the hand-off', async () => {
  const server = new FakeServer()
  const { h, attached, sinceStreamed } = await reattachedOwnRun(server)
  try {
    await complete(h, attached)
    assert.deepEqual(consecutive(sinceStreamed()), [1])
    assert.equal(h.query('[data-role="assistant"]')?.textContent, SEALED_TEXT)
    assert.equal(h.query('[data-testid="streaming-turn"]'), null)
    assert.equal(h.button('Send').disabled, false)
  } finally {
    await h.cleanup()
  }
})

test('a reattached own run that ends without its answer in the thread keeps the streamed answer beside the failure', async () => {
  for (const [ending, payload, notice] of [
    ['turn.error', { error: 'upstream_500' }, /Stream error: upstream_500/],
    ['turn.completed', { message_id: 'a1' }, /The saved copy of this answer isn't in the thread yet\./],
  ] as const) {
    const server = new FakeServer()
    const { h, attached, sinceStreamed } = await reattachedOwnRun(server)
    try {
      await act(async () => attached.emit(ending, 5, payload))
      await h.flush()
      assert.deepEqual(consecutive(sinceStreamed()), [1], ending)
      assert.equal(h.query('[data-testid="streaming-turn"]')?.getAttribute('data-turn-status'), 'failed', ending)
      assert.match(h.text(), notice)
    } finally {
      await h.cleanup()
    }
  }
})
