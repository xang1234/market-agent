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
  FakeServer,
  deferred,
  renderChat,
  occurrences,
  streamAnswer,
  complete,
  HISTORY_T1,
  SEALED_TEXT,
  TWO_THREADS,
  T2_QUESTION,
  STILL_ANSWERING,
  openThread,
  consecutive,
  RUN_OF,
  streamParams,
  threadRead,
  type Harness,
} from './chatPageHarness.tsx'

const R1_IN_FLIGHT = { run_id: 'r1', turn_id: 'u1', status: 'in_flight' } as const

async function dropStream(h: Harness, source: FakeEventSource) {
  await act(async () => source.onerror?.())
  await h.flush()
}

test('an own stream that fails before the server has the run reopens with the same ask, which starts it', async () => {
  const server = new FakeServer()
  server.history = (id) => ({ body: { messages: server.posted.size === 0 ? [] : [server.postedUser(id)], active_run: null } })
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    const own = FakeEventSource.instances[0]
    await dropStream(h, own)

    assert.equal(FakeEventSource.instances.length, 2)
    const reopened = FakeEventSource.instances[1]
    assert.deepEqual(streamParams(reopened), streamParams(own))
    assert.equal(reopened.params.get('attach'), null)
    assert.equal(server.gets(HISTORY_T1), 1)
    assert.equal(h.button('Send').disabled, true)

    await streamAnswer(h, reopened)
    await complete(h, reopened)
    assert.equal(occurrences(h.text(), ANSWER), 1)
    assert.equal(h.query('[data-role="assistant"]')?.textContent, SEALED_TEXT)
    assert.equal(h.button('Send').disabled, false)
  } finally {
    await h.cleanup()
  }
})

test('an own stream that never reaches the server goes offline after its reopens, and Reconnect sends the same request again', async () => {
  const server = new FakeServer()
  server.history = (id) => threadRead(server.posted.size === 0 ? [] : [server.postedUser(id)])
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    const own = FakeEventSource.instances[0]
    for (let i = 0; i < 4; i++) await dropStream(h, FakeEventSource.instances.at(-1)!)

    assert.equal(FakeEventSource.instances.length, 4)
    assert.deepEqual(FakeEventSource.instances.map((source) => streamParams(source)), Array(4).fill(streamParams(own)))
    assert.equal(server.gets(HISTORY_T1), 1)
    assert.match(h.text(), /Lost the connection to the analyst\./)
    assert.equal(h.button('Send').disabled, true)

    await act(async () => h.button('Reconnect').click())
    await h.flush()
    assert.equal(FakeEventSource.instances.length, 5)
    assert.deepEqual(streamParams(FakeEventSource.instances.at(-1)!), streamParams(own))
    assert.equal(server.gets(HISTORY_T1), 1)
    assert.notEqual(h.query('[data-testid="streaming-turn"]'), null)
    assert.equal(h.button('Send').disabled, true)
  } finally {
    await h.cleanup()
  }
})

test('leaving chat closes an attached stream', async () => {
  const server = new FakeServer()
  server.history = () => ({ body: { messages: [], active_run: { run_id: 'r1', turn_id: 'u1' } } })
  const h = await renderChat('/chat/T1', server)
  try {
    const attached = FakeEventSource.instances[0]
    await act(async () => attached.emit('turn.started', 1))
    await h.navigate('/home')
    assert.equal(attached.closed, true)
  } finally {
    await h.cleanup()
  }
})

test('leaving chat while the thread is being created stays away, and the question still posts and starts its run', async () => {
  const server = new FakeServer()
  const created = deferred<void>()
  server.createReply = () => created.promise.then(() => ({ status: 201, body: server.createThread() }))
  const h = await renderChat('/chat', server)
  try {
    await h.ask('Analyze NVDA')
    await h.navigate('/home')
    assert.equal(h.path(), '/home')

    await act(async () => created.resolve())
    await h.flush()

    assert.equal(h.path(), '/home')
    assert.equal(h.text(), 'Home')
    assert.deepEqual(server.writes().map(([method, path]) => [method, path]), [
      ['POST', '/v1/chat/threads'],
      ['POST', '/v1/chat/threads/T1/messages'],
    ])
    assert.equal(FakeEventSource.instances.length, 1)
    const starter = FakeEventSource.instances[0]
    assert.match(starter.url, /^\/v1\/chat\/threads\/T1\/stream\?/)
    assert.equal(starter.params.get('user_intent'), 'Analyze NVDA')
    assert.equal(starter.closed, false)
    await act(async () => starter.open())
    assert.equal(starter.closed, true)
    assert.equal(server.gets(HISTORY_T1), 0)
  } finally {
    await h.cleanup()
  }
})

test('returning to a thread whose question is still being saved follows its run as soon as the save lands', async () => {
  const server = new FakeServer()
  server.threads = TWO_THREADS
  const saved = deferred<void>()
  server.postReply = (message) => saved.promise.then(() => ({ status: 201, body: { message } }))
  let started = false
  server.history = (id) => ({
    body: id === 'T2'
      ? { messages: [T2_QUESTION], active_run: null }
      : threadRead(started ? [server.postedUser('T1')] : [], started ? [{ ...RUN_OF(server), status: 'in_flight' }] : []).body,
  })
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    await openThread(h, 'T2')
    await openThread(h, 'T1')
    assert.equal(server.gets(HISTORY_T1), 2)

    started = true
    await act(async () => saved.resolve())
    await h.flush()
    assert.equal(FakeEventSource.instances.length, 2)
    const [followed, starter] = FakeEventSource.instances
    assert.deepEqual(streamParams(followed), streamParams(starter))
    assert.equal(starter.params.get('user_intent'), 'Analyze NVDA')
    assert.equal(server.gets(HISTORY_T1), 3)
    assert.equal(h.button('Send').disabled, true)

    await act(async () => starter.open())
    assert.equal(starter.closed, true)
    await streamAnswer(h, followed)
    await complete(h, followed)
    assert.equal(occurrences(h.text(), ANSWER), 1)
    assert.equal(h.query('[data-role="assistant"]')?.textContent, SEALED_TEXT)
    assert.equal(h.query('[data-role="user"]')?.textContent, 'Analyze NVDA')
    assert.equal(h.button('Send').disabled, false)
    assert.equal(server.writes().length, 1)
  } finally {
    await h.cleanup()
  }
})

function switchedAwayServer() {
  const server = new FakeServer()
  server.threads = TWO_THREADS
  const state = { started: false }
  server.history = (id) => ({
    body: id === 'T2'
      ? { messages: [T2_QUESTION], active_run: null }
      : threadRead(server.posted.size === 0 ? [] : [server.postedUser('T1')], state.started ? [{ ...RUN_OF(server), status: 'in_flight' }] : []).body,
  })
  return { server, state }
}

test('a released stream that has not reached the server is sent again by the thread it was sent from, once its load lacks the run', async () => {
  const { server, state } = switchedAwayServer()
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    const own = FakeEventSource.instances[0]
    await openThread(h, 'T2')
    await openThread(h, 'T1')
    assert.equal(server.gets(HISTORY_T1), 2)
    assert.equal(FakeEventSource.instances.length, 2)
    const resent = FakeEventSource.instances[1]
    assert.deepEqual(streamParams(resent), streamParams(own))
    assert.equal(h.button('Send').disabled, true)

    state.started = true
    await act(async () => own.open())
    await h.flush()
    assert.equal(own.closed, true)
    assert.equal(FakeEventSource.instances.length, 2)
    await streamAnswer(h, resent)
    await complete(h, resent)
    assert.equal(occurrences(h.text(), ANSWER), 1)
    assert.equal(h.button('Send').disabled, false)
  } finally {
    await h.cleanup()
  }
})

test('a released run whose every start fails, on the thread on screen, ends offline with Reconnect', async () => {
  const { server } = switchedAwayServer()
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    await openThread(h, 'T2')
    await openThread(h, 'T1')
    const resent = () => FakeEventSource.instances.filter((source) => !source.closed && source.params.get('attach') === null)
    for (let i = 0; i < 8 && resent().length > 0; i++) await dropStream(h, resent().at(-1)!)

    assert.equal(FakeEventSource.instances.every((source) => source.params.get('attach') === null), true)
    assert.equal(h.button('Reconnect').disabled, false)
    assert.equal(h.button('Send').disabled, true)
  } finally {
    await h.cleanup()
  }
})

test('switching away and back mid-run reattaches with attach=1 and shows the sealed answer once in every commit', async () => {
  const server = new FakeServer()
  server.threads = TWO_THREADS
  server.history = (id) => ({
    body: id === 'T2'
      ? { messages: [T2_QUESTION], active_run: null }
      : threadRead(server.posted.size === 0 ? [] : [server.postedUser('T1')], server.posted.size === 0 ? [] : [{ ...RUN_OF(server), status: 'in_flight' }]).body,
  })
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    const own = FakeEventSource.instances[0]
    await streamAnswer(h, own)
    await openThread(h, 'T2')
    assert.equal(own.closed, true)
    const returned = h.frames.length
    await openThread(h, 'T1')

    assert.equal(FakeEventSource.instances.length, 2)
    const attached = FakeEventSource.instances[1]
    assert.deepEqual(streamParams(attached), { run_id: own.params.get('run_id'), turn_id: own.params.get('turn_id'), user_id: USER_ID, attach: '1' })
    assert.equal(h.button('Send').disabled, true)
    assert.match(h.text(), STILL_ANSWERING)
    assert.equal(h.query('[data-testid="streaming-turn"]')?.getAttribute('data-turn-status'), 'streaming')

    await streamAnswer(h, attached)
    await complete(h, attached)

    assert.deepEqual(consecutive(h.frames.slice(returned).map((frame) => occurrences(frame, ANSWER))), [0, 1])
    assert.equal(FakeEventSource.instances.length, 2)
    assert.doesNotMatch(h.text(), STILL_ANSWERING)
    assert.equal(h.button('Send').disabled, false)
  } finally {
    await h.cleanup()
  }
})

test('a fresh mount on a thread with an active run shows it in progress, Send disabled, then the sealed answer once in every commit', async () => {
  const server = new FakeServer()
  server.history = (id) => threadRead([chatMessage(id, 'u1', 'user', 'Analyze NVDA')], [R1_IN_FLIGHT])
  const h = await renderChat('/chat/T1', server)
  try {
    assert.equal(FakeEventSource.instances.length, 1)
    const attached = FakeEventSource.instances[0]
    assert.deepEqual(streamParams(attached), { run_id: 'r1', turn_id: 'u1', user_id: USER_ID, attach: '1' })
    assert.equal(h.query('[data-testid="streaming-turn"]')?.getAttribute('data-turn-status'), 'streaming')
    assert.match(h.text(), STILL_ANSWERING)
    assert.equal(h.button('Send').disabled, true)

    await act(async () => {
      attached.emit('turn.started', 1)
      attached.emit('tool.started', 2, { tool_call_id: 't1', tool_name: 'get_quote' })
    })
    await h.flush()
    assert.equal(h.button('Send').disabled, true)
    await streamAnswer(h, attached)
    await complete(h, attached)

    assert.deepEqual(consecutive(h.frames.map((frame) => occurrences(frame, ANSWER))), [0, 1])
    assert.equal(h.query('[data-role="assistant"]')?.textContent, SEALED_TEXT)
    assert.equal(h.query('[data-testid="streaming-turn"]'), null)
    assert.equal(h.button('Send').disabled, false)
    assert.equal(server.gets(HISTORY_T1), 1)
    assert.equal(FakeEventSource.instances.length, 1)
  } finally {
    await h.cleanup()
  }
})

const answerOnceFromFirst = (h: Harness) => {
  const first = h.frames.findIndex((frame) => frame.includes(ANSWER))
  assert.notEqual(first, -1)
  return h.frames.slice(first).map((frame) => occurrences(frame, ANSWER)).filter((count) => count !== 1)
}

test('an unsealed completion of an adopted run whose answer the load holds hands off at once, the answer once in every commit', async () => {
  const server = new FakeServer()
  server.history = (id) => ({ body: { messages: [chatMessage(id, 'u1', 'user', 'Analyze NVDA'), sealedAnswer(id)], active_run: { run_id: 'r1', turn_id: 'u1' } } })
  const h = await renderChat('/chat/T1', server)
  try {
    const attached = FakeEventSource.instances[0]
    await streamAnswer(h, attached)
    await act(async () => attached.emit('turn.completed', 5, { message_id: 'a1' }))
    await h.flush()

    assert.deepEqual(answerOnceFromFirst(h), [])
    assert.equal(h.query('[data-testid="streaming-turn"]'), null)
    assert.equal(server.gets(HISTORY_T1), 1)
    assert.equal(h.button('Send').disabled, false)
  } finally {
    await h.cleanup()
  }
})

test('an adopted run that fails never shows its streamed blocks beside the answer the load holds', async () => {
  const server = new FakeServer()
  const reloaded = deferred<{ body: unknown }>()
  let reads = 0
  server.history = (id) => (++reads === 1
    ? { body: { messages: [chatMessage(id, 'u1', 'user', 'Analyze NVDA'), sealedAnswer(id)], active_run: { run_id: 'r1', turn_id: 'u1' } } }
    : reloaded.promise)
  const h = await renderChat('/chat/T1', server)
  try {
    const attached = FakeEventSource.instances[0]
    await streamAnswer(h, attached)
    await act(async () => attached.emit('turn.completed', 5, {}))
    await h.flush()
    assert.equal(h.query('[data-testid="streaming-turn"]')?.getAttribute('data-turn-status'), 'failed')
    assert.equal(server.gets(HISTORY_T1), 2)

    await act(async () => reloaded.resolve({ body: { messages: [chatMessage('T1', 'u1', 'user', 'Analyze NVDA'), sealedAnswer('T1')], active_run: null } }))
    await h.flush()
    assert.deepEqual(answerOnceFromFirst(h), [])
    assert.equal(h.query('[data-testid="streaming-turn"]'), null)
  } finally {
    await h.cleanup()
  }
})

test('an attached stream that drops while the run continues reattaches through a load, and the answer shows once', async () => {
  const server = new FakeServer()
  server.history = (id) => threadRead([chatMessage(id, 'u1', 'user', 'Analyze NVDA')], [R1_IN_FLIGHT])
  const h = await renderChat('/chat/T1', server)
  try {
    const first = FakeEventSource.instances[0]
    await act(async () => first.emit('turn.started', 1))
    await act(async () => first.onerror?.())
    await h.flush()

    assert.equal(server.gets(HISTORY_T1), 2)
    assert.doesNotMatch(h.text(), /disconnected/)
    assert.equal(h.button('Send').disabled, true)
    assert.equal(FakeEventSource.instances.length, 2)
    const second = FakeEventSource.instances[1]
    assert.deepEqual(streamParams(second), { run_id: 'r1', turn_id: 'u1', user_id: USER_ID, attach: '1' })

    await streamAnswer(h, second)
    await complete(h, second)
    assert.deepEqual(consecutive(h.frames.map((frame) => occurrences(frame, ANSWER))), [0, 1])
    assert.equal(h.button('Send').disabled, false)
  } finally {
    await h.cleanup()
  }
})

test('an attached stream that delivers a new event between drops keeps reattaching and never shows Reconnect', async () => {
  const server = new FakeServer()
  server.history = (id) => threadRead([chatMessage(id, 'u1', 'user', 'Analyze NVDA')], [R1_IN_FLIGHT])
  const h = await renderChat('/chat/T1', server)
  try {
    for (let i = 0; i < 4; i++) {
      const source = FakeEventSource.instances.at(-1)!
      await act(async () => {
        source.emit('turn.started', 1)
        source.emit('tool.started', i + 2, { tool_call_id: `t${i}`, tool_name: 'get_quote' })
      })
      await dropStream(h, source)
    }
    assert.equal(FakeEventSource.instances.length, 5)
    assert.equal(FakeEventSource.instances[4].closed, false)
    assert.doesNotMatch(h.text(), /Lost the connection/)
    assert.match(h.text(), STILL_ANSWERING)
  } finally {
    await h.cleanup()
  }
})

test('three failed reattaches show Reconnect with Send disabled, and Reconnect asks the server again', async () => {
  const server = new FakeServer()
  server.history = (id) => threadRead([chatMessage(id, 'u1', 'user', 'Analyze NVDA')], [R1_IN_FLIGHT])
  const h = await renderChat('/chat/T1', server)
  try {
    for (let i = 0; i < 4; i++) {
      await act(async () => FakeEventSource.instances.at(-1)!.onerror?.())
      await h.flush()
    }
    assert.equal(FakeEventSource.instances.length, 4)
    assert.equal(server.gets(HISTORY_T1), 4)
    assert.equal(FakeEventSource.instances.every((source) => source.closed), true)
    assert.match(h.text(), /Lost the connection to the analyst\./)
    assert.equal(h.button('Send').disabled, true)

    await act(async () => h.button('Reconnect').click())
    await h.flush()
    assert.equal(server.gets(HISTORY_T1), 5)
    assert.equal(FakeEventSource.instances.length, 5)
    assert.equal(FakeEventSource.instances[4].params.get('attach'), '1')
    assert.doesNotMatch(h.text(), /Lost the connection/)
    assert.equal(h.button('Send').disabled, true)
  } finally {
    await h.cleanup()
  }
})
