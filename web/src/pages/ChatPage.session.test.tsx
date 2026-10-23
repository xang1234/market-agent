import './installDomBeforeReact.ts'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { act } from 'react'

import type { ChatMessage } from '../chat/messageTypes.ts'
import {
  ANSWER,
  UUID_PATTERN,
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
  openThread,
  type Harness,
} from './chatPageHarness.tsx'

test('the completion hands off to the sealed answer it carries: no history GET, and the answer once in every commit', async () => {
  const server = new FakeServer()
  const h = await renderChat('/chat', server)
  try {
    await h.ask('Analyze NVDA')
    assert.equal(h.path(), '/chat/T1')
    await streamAnswer(h, FakeEventSource.instances[0])
    const listBefore = h.query('[data-testid="virtualized-message-list"]')
    assert.notEqual(listBefore, null)
    await complete(h, FakeEventSource.instances[0])

    assert.equal(server.gets(HISTORY_T1), 0)
    const first = h.frames.findIndex((frame) => frame.includes(ANSWER))
    assert.notEqual(first, -1)
    assert.deepEqual(
      h.frames.slice(first).map((frame) => occurrences(frame, ANSWER)).filter((count) => count !== 1),
      [],
    )
    assert.deepEqual(h.statusFrames.filter((labels) => labels.includes('Loading message history')), [])
    assert.equal(h.query('[data-testid="virtualized-message-list"]'), listBefore)
    assert.equal(h.query('[data-role="assistant"]')?.textContent, SEALED_TEXT)
    assert.equal(h.container.querySelectorAll('[data-testid="streaming-turn"]').length, 0)
    assert.equal(h.button('Send').disabled, false)

    await h.ask('Compare with AMD')
    await secondTurn(h, FakeEventSource.instances[1])
    assert.equal(server.gets(HISTORY_T1), 0)
    assert.deepEqual(roles(h), [['user', 'Analyze NVDA'], ['assistant', SEALED_TEXT], ['user', 'Compare with AMD'], ['assistant', SECOND_SEALED_TEXT]])
  } finally {
    await h.cleanup()
  }
})

const SECOND_ANSWER = 'AMD trails on margin'
const SECOND_SEALED_TEXT = `Source-linked narrative${SECOND_ANSWER}`

const secondAnswer = (threadId: string) => chatMessage(threadId, 'a2', 'assistant', SECOND_ANSWER, {
  block_proofs: { 'a2-block': { evidence: 'linked', calculation: 'not_verified', public_by_cutoff: 'unknown' } },
})

async function secondTurn(h: Harness, source: FakeEventSource) {
  const a2 = secondAnswer(source.threadId)
  await act(async () => {
    source.emit('turn.started', 1)
    source.emit('block.began', 2, { block_id: 'b2', kind: 'rich_text' })
    source.emit('block.delta', 3, { block_id: 'b2', delta: { segment: { type: 'text', text: SECOND_ANSWER } } })
    source.emit('block.completed', 4, { block_id: 'b2', content_hash: 'h2' })
    source.emit('turn.completed', 5, { message_id: 'a2', message: a2 })
  })
  await h.flush()
}

const roles = (h: Harness) =>
  [...h.container.querySelectorAll('[data-role]')].map((node) => [node.getAttribute('data-role'), node.textContent])

test('on an open thread the completion adds no history GET to the one that opened it', async () => {
  const server = new FakeServer()
  server.threads = [{ thread_id: 'T1', title: 'Chips', updated_at: '2026-05-06T00:00:00.000Z' }]
  const h = await renderChat('/chat/T1', server)
  try {
    assert.equal(server.gets(HISTORY_T1), 1)
    await h.ask('Analyze NVDA')
    await streamAnswer(h, FakeEventSource.instances[0])
    await complete(h, FakeEventSource.instances[0])

    assert.equal(server.gets(HISTORY_T1), 1)
    assert.deepEqual(
      [...h.container.querySelectorAll('[data-role]')].map((node) => [node.getAttribute('data-role'), node.textContent]),
      [['user', 'Analyze NVDA'], ['assistant', SEALED_TEXT]],
    )
  } finally {
    await h.cleanup()
  }
})

test('ask first keeps the answer on screen through the hand-off while the thread route has not committed', async () => {
  const server = new FakeServer()
  const threadRoute = deferred<null>()
  const h = await renderChat('/chat', server, { threadRoute: threadRoute.promise })
  try {
    await h.ask('Analyze NVDA')
    await streamAnswer(h, FakeEventSource.instances[0])
    const list = h.query('[data-testid="virtualized-message-list"]')
    await complete(h, FakeEventSource.instances[0])

    assert.equal(h.path(), '/chat')
    assert.equal(server.gets(HISTORY_T1), 0)
    const first = h.frames.findIndex((frame) => frame.includes(ANSWER))
    assert.notEqual(first, -1)
    assert.deepEqual(
      h.frames.slice(first).map((frame) => occurrences(frame, ANSWER)).filter((count) => count !== 1),
      [],
    )
    assert.equal(h.query('[data-role="assistant"]')?.textContent, SEALED_TEXT)
    assert.notEqual(list, null)
    assert.equal(h.query('[data-testid="virtualized-message-list"]'), list)

    await act(async () => threadRoute.resolve(null))
    await h.flush()
    assert.equal(h.path(), '/chat/T1')
    assert.equal(server.gets(HISTORY_T1), 0)
    assert.equal(h.query('[data-testid="virtualized-message-list"]'), list)
    assert.equal(occurrences(h.text(), ANSWER), 1)
  } finally {
    await h.cleanup()
  }
})

test('a completion whose sealed message is malformed loads the thread itself, never renders that message, and hands off to the load', async () => {
  const server = new FakeServer()
  const reloaded = deferred<{ body: unknown }>()
  server.history = () => reloaded.promise
  const h = await renderChat('/chat', server)
  try {
    await h.ask('Analyze NVDA')
    await streamAnswer(h, FakeEventSource.instances[0])
    const unproven = chatMessage('T1', 'a1', 'assistant', 'Unchecked copy')
    await complete(h, FakeEventSource.instances[0], unproven)

    assert.equal(server.gets(HISTORY_T1), 1)
    assert.match(h.text(), /Couldn't show the saved copy of this answer\./)
    assert.equal(h.button('Reload thread').disabled, false)
    assert.equal([...h.container.querySelectorAll('button')].some((button) => button.textContent === 'Retry'), false)
    assert.equal(occurrences(h.text(), ANSWER), 1)
    assert.equal(h.query('[data-role="assistant"]'), null)
    assert.deepEqual(h.frames.filter((frame) => frame.includes('Unchecked copy')), [])

    await act(async () => reloaded.resolve({ body: { messages: [server.postedUser('T1'), sealedAnswer('T1')], active_run: null } }))
    await h.flush()

    assert.equal(h.query('[data-testid="streaming-turn"]'), null)
    assert.equal(h.query('[data-role="assistant"]')?.textContent, SEALED_TEXT)
    const first = h.frames.findIndex((frame) => frame.includes(ANSWER))
    assert.deepEqual(
      h.frames.slice(first).map((frame) => occurrences(frame, ANSWER)).filter((count) => count !== 1),
      [],
    )
    assert.equal(FakeEventSource.instances.length, 1)
  } finally {
    await h.cleanup()
  }
})

test('a failed reload keeps the streamed answer and Reload thread, and a later reload hands off', async () => {
  const server = new FakeServer()
  let reloads = 0
  server.history = (id) => (++reloads === 1 ? { status: 503, body: { error: 'unavailable' } } : { body: { messages: [server.postedUser(id), sealedAnswer(id)] } })
  const h = await renderChat('/chat', server)
  try {
    await h.ask('Analyze NVDA')
    await streamAnswer(h, FakeEventSource.instances[0])
    await act(async () => FakeEventSource.instances[0].emit('turn.completed', 5, { message_id: 'a1' }))
    await h.flush()

    assert.equal(server.gets(HISTORY_T1), 1)
    assert.match(h.text(), /Couldn't load the saved copy of this answer\./)
    assert.equal(h.query('[data-testid="streaming-turn"]')?.textContent?.includes(ANSWER), true)
    assert.equal(h.button('Reload thread').disabled, false)

    await act(async () => h.button('Reload thread').click())
    await h.flush()
    assert.equal(server.gets(HISTORY_T1), 2)
    assert.equal(h.query('[data-testid="streaming-turn"]'), null)
    assert.equal(h.query('[data-role="assistant"]')?.textContent, SEALED_TEXT)
    const first = h.frames.findIndex((frame) => frame.includes(ANSWER))
    assert.deepEqual(
      h.frames.slice(first).map((frame) => occurrences(frame, ANSWER)).filter((count) => count !== 1),
      [],
    )
  } finally {
    await h.cleanup()
  }
})

test('ask first under StrictMode creates the thread, posts the question and opens one stream', async () => {
  const server = new FakeServer()
  const h = await renderChat('/chat', server, { strict: true })
  try {
    await h.ask('Analyze NVDA')

    const writes = server.writes()
    assert.deepEqual(writes.map(([method, path]) => [method, path]), [
      ['POST', '/v1/chat/threads'],
      ['POST', '/v1/chat/threads/T1/messages'],
    ])
    assert.equal(writes[0][2], '{"title":null}')
    const posted = JSON.parse(writes[1][2]) as Record<string, string>
    assert.deepEqual(Object.keys(posted), ['message_id', 'snapshot_id', 'content'])
    assert.equal(posted.content, 'Analyze NVDA')
    assert.equal(FakeEventSource.instances.length, 1)
    assert.match(FakeEventSource.instances[0].url, /^\/v1\/chat\/threads\/T1\/stream\?/)
    assert.match(FakeEventSource.instances[0].url, /user_intent=Analyze\+NVDA/)
    assert.equal(FakeEventSource.instances[0].params.get('turn_id'), posted.message_id)
    assert.deepEqual([...FakeEventSource.instances[0].params.keys()], ['run_id', 'turn_id', 'user_intent', 'user_id'])
    assert.equal(h.path(), '/chat/T1')
    assert.equal(h.query('[data-testid="thread-name"]')?.textContent, 'Analyze NVDA')
    assert.equal(h.query('[data-role="user"]')?.textContent, 'Analyze NVDA')
    assert.equal(h.button('Send').disabled, true)
  } finally {
    await h.cleanup()
  }
})

test('two Enter presses in one act post the question once and keep the second as a no-op', async () => {
  const server = new FakeServer()
  server.threads = [{ thread_id: 'T1', title: 'Chips', updated_at: '2026-05-06T00:00:00.000Z' }]
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA', 2)
    assert.deepEqual(server.writes().map(([method, path]) => [method, path]), [['POST', '/v1/chat/threads/T1/messages']])
    assert.equal(FakeEventSource.instances.length, 1)
  } finally {
    await h.cleanup()
  }
})

test('the header and the active row show the question, then the server title once the follow-up finds it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const threadId = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5'
  const server = new FakeServer()
  server.createdThreadId = threadId
  server.history = (id) => ({ body: { messages: [server.postedUser(id), sealedAnswer(id)] } })
  const h = await renderChat('/chat', server)
  try {
    await h.ask('Analyze NVDA')
    await streamAnswer(h, FakeEventSource.instances[0])
    await complete(h, FakeEventSource.instances[0])
    assert.equal(h.query('[data-testid="streaming-turn"]'), null)

    const header = () => h.query('[data-testid="thread-name"]')?.textContent
    const activeRow = () => h.query('[aria-current="page"] span')?.textContent
    assert.equal(header(), 'Analyze NVDA')
    assert.equal(activeRow(), 'Analyze NVDA')
    assert.doesNotMatch(h.text(), UUID_PATTERN)
    const listReads = server.gets('/v1/chat/threads')

    t.mock.timers.tick(0)
    await h.flush()
    assert.equal(server.gets('/v1/chat/threads'), listReads + 1)
    assert.equal(header(), 'Analyze NVDA')

    server.threads = server.threads.map((thread) => ({ ...thread, title: 'NVIDIA Analysis' }))
    t.mock.timers.tick(2000)
    await h.flush()
    assert.equal(server.gets('/v1/chat/threads'), listReads + 2)
    assert.equal(header(), 'NVIDIA Analysis')
    assert.equal(activeRow(), 'NVIDIA Analysis')

    t.mock.timers.tick(3000)
    await h.flush()
    t.mock.timers.tick(5000)
    await h.flush()
    assert.equal(server.gets('/v1/chat/threads'), listReads + 2)
    assert.doesNotMatch(h.text(), UUID_PATTERN)
  } finally {
    await h.cleanup()
  }
})

test('switching threads mid-stream closes the connected stream and shows nothing of it on the other thread', async () => {
  const server = new FakeServer()
  server.threads = TWO_THREADS
  server.history = (id) => ({
    body: { messages: id === 'T2' ? [T2_QUESTION] : [] },
  })
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    const source = FakeEventSource.instances[0]
    await streamAnswer(h, source)
    assert.equal(occurrences(h.text(), ANSWER), 1)

    await openThread(h, 'T2')

    assert.equal(h.path(), '/chat/T2')
    assert.equal(source.closed, true)
    assert.equal(h.query('[data-role="user"]')?.textContent, 'What did the Fed do?')
    assert.equal(occurrences(h.text(), ANSWER), 0)
    assert.equal(server.gets(HISTORY_T1), 1)
    assert.equal(FakeEventSource.instances.length, 1)
  } finally {
    await h.cleanup()
  }
})

test('a completion without message_id loads the thread itself, and that load settles the turn', async () => {
  const server = new FakeServer()
  server.history = (id) => ({ body: { messages: server.posted.size === 0 ? [] : [server.postedUser(id), sealedAnswer(id)], active_run: null } })
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    await streamAnswer(h, FakeEventSource.instances[0])
    await act(async () => FakeEventSource.instances[0].emit('turn.completed', 5, {}))
    await h.flush()

    assert.equal(server.gets(HISTORY_T1), 2)
    assert.equal(h.query('[data-testid="streaming-turn"]'), null)
    assert.equal(h.query('[data-role="assistant"]')?.textContent, SEALED_TEXT)
    assert.equal(occurrences(h.text(), ANSWER), 1)
    assert.equal(h.button('Send').disabled, false)
  } finally {
    await h.cleanup()
  }
})

test('a draft typed while the first question is being sent survives the move to the new thread', async () => {
  const server = new FakeServer()
  const created = deferred<void>()
  server.createReply = () => created.promise.then(() => ({ status: 201, body: server.createThread() }))
  const h = await renderChat('/chat', server)
  try {
    await h.ask('Analyze NVDA')
    await h.type('Follow up')

    await act(async () => created.resolve())
    await h.flush()

    assert.equal(h.path(), '/chat/T1')
    assert.equal(h.container.querySelectorAll('textarea').length, 1)
    assert.equal((h.query('textarea') as HTMLTextAreaElement).value, 'Follow up')
  } finally {
    await h.cleanup()
  }
})

test('a failed title refresh keeps the sidebar row and the header name', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const server = new FakeServer()
  server.threads = [{ thread_id: 'T1', title: 'Chips', updated_at: '2026-05-06T00:00:00.000Z' }]
  server.history = (id) => ({ body: { messages: server.posted.size === 0 ? [] : [server.postedUser(id), sealedAnswer(id)] } })
  const h = await renderChat('/chat/T1', server)
  try {
    await h.ask('Analyze NVDA')
    await streamAnswer(h, FakeEventSource.instances[0])
    await complete(h, FakeEventSource.instances[0])
    const listReads = server.gets('/v1/chat/threads')

    server.listReply = () => ({ status: 502, body: { error: 'bad gateway' } })
    t.mock.timers.tick(0)
    await h.flush()

    assert.equal(server.gets('/v1/chat/threads'), listReads + 1)
    assert.equal(h.query('a[href="/chat/T1"] span')?.textContent, 'Chips')
    assert.equal(h.query('[data-testid="thread-name"]')?.textContent, 'Chips')
    assert.doesNotMatch(h.text(), /HTTP 502/)
  } finally {
    await h.cleanup()
  }
})

const GOLDEN = JSON.parse(readFileSync(new URL('../../../services/app/fixtures/golden-conversation.replay.json', import.meta.url), 'utf-8')) as {
  exchanges: Array<{ method: string; path: string; body: string }>
}
// Read from the recording, so a recapture's new ids need no edit here.
const GOLDEN_THREAD = goldenCompletion().thread_id
const GOLDEN_RICH_TEXT = goldenCompletion().message.blocks.find((block) => block.kind === 'rich_text')!.id

function goldenCompletion(): { thread_id: string; message_id: string; message: ChatMessage } {
  const stream = GOLDEN.exchanges.find((exchange) => exchange.path.endsWith('/stream'))!
  const frame = stream.body.split('\n\n').find((chunk) => chunk.includes('event: turn.completed'))!
  return JSON.parse(frame.split('\n').find((line) => line.startsWith('data: '))!.slice('data: '.length))
}

function goldenHistory(): ChatMessage[] {
  const read = GOLDEN.exchanges.find((exchange) => exchange.method === 'GET' && exchange.path === `/v1/chat/threads/${GOLDEN_THREAD}/messages`)!
  return (JSON.parse(read.body) as { messages: ChatMessage[] }).messages
}

function withoutSegments<T extends { blocks: ChatMessage['blocks'] }>(message: T, blockId: string): T {
  return {
    ...message,
    blocks: message.blocks.map((block) => block.id === blockId ? Object.fromEntries(Object.entries(block).filter(([key]) => key !== 'segments')) : block),
  }
}

const notices = (h: Harness) =>
  [...h.container.querySelectorAll('[data-testid="block-render-failed"]')]
    .map((node) => [node.getAttribute('data-block-id'), node.getAttribute('data-block-kind'), node.textContent])

const NOTICE = "This part of the answer couldn't be displayed."

// console.error calls that name the block: the boundary's own log, not React's.
function captureBlockErrors(blockId: string): { calls: () => number; restore: () => void } {
  const original = console.error
  let calls = 0
  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes(blockId))) calls += 1
  }
  return { calls: () => calls, restore: () => { console.error = original } }
}

async function completeGolden(h: Harness, message: ChatMessage) {
  const source = FakeEventSource.instances[0]
  await act(async () => {
    source.emit('turn.started', 1)
    source.emit('turn.completed', 2, { message_id: message.message_id, message })
  })
  await h.flush()
}

test('a golden completion whose rich_text lost its segments shows a notice in that block, and the rest of the answer renders', async () => {
  const server = new FakeServer()
  server.createdThreadId = GOLDEN_THREAD
  const errors = captureBlockErrors(GOLDEN_RICH_TEXT)
  const h = await renderChat('/chat', server)
  try {
    await h.ask('Analyze NVDA')
    await completeGolden(h, withoutSegments(goldenCompletion().message, GOLDEN_RICH_TEXT))

    assert.equal(server.gets(`/v1/chat/threads/${GOLDEN_THREAD}/messages`), 0)
    assert.deepEqual(notices(h), [[GOLDEN_RICH_TEXT, 'rich_text', NOTICE]])
    const answer = h.query('[data-role="assistant"]')?.textContent ?? ''
    assert.deepEqual(
      ['All 24 requested results verified', 'NVIDIA Corporation: Revenue', NOTICE].map((text) => answer.includes(text)),
      [true, true, true],
    )
    assert.equal(errors.calls(), 1)
    assert.equal(h.button('Send').disabled, false)
  } finally {
    errors.restore()
    await h.cleanup()
  }
})

test('the same malformed block read by the messages GET shows the notice, and the thread renders', async () => {
  const server = new FakeServer()
  const [user, answer, ...rest] = goldenHistory()
  server.history = () => ({ body: { messages: [user, withoutSegments(answer, GOLDEN_RICH_TEXT), ...rest] } })
  const errors = captureBlockErrors(GOLDEN_RICH_TEXT)
  const h = await renderChat(`/chat/${GOLDEN_THREAD}`, server)
  try {
    assert.equal(server.gets(`/v1/chat/threads/${GOLDEN_THREAD}/messages`), 1)
    assert.deepEqual(notices(h), [[GOLDEN_RICH_TEXT, 'rich_text', NOTICE]])
    assert.deepEqual(roles(h).slice(0, 2).map(([role]) => role), ['user', 'assistant'])
    assert.match(h.text(), /NVIDIA Corporation: Revenue/)
    assert.equal(errors.calls(), 1)
  } finally {
    errors.restore()
    await h.cleanup()
  }
})

test('a valid golden completion renders every block with no notice', async () => {
  const server = new FakeServer()
  server.createdThreadId = GOLDEN_THREAD
  const h = await renderChat('/chat', server)
  try {
    await h.ask('Analyze NVDA')
    await completeGolden(h, goldenCompletion().message)

    assert.deepEqual(notices(h), [])
    const answer = h.query('[data-role="assistant"]')?.textContent ?? ''
    assert.deepEqual(
      ["NVDA's revenue rose in every period from Q1 FY2025 (USD 26,044,000,000.00) to Q4 FY2026 (USD 62,100,000,000.00).", 'All 24 requested results verified', 'NVIDIA Corporation: Revenue'].map((text) => answer.includes(text)),
      [true, true, true],
    )
  } finally {
    await h.cleanup()
  }
})
