import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import fixture from '../../../services/app/fixtures/golden-conversation.replay.json'
import { extractInspectableRefs, type InspectableBlockRef } from '../evidence/inspectableRefs.ts'
import { fetchEvidenceInspection } from '../evidence/inspectionClient.ts'
import { HttpJsonError } from '../http/authFetch.ts'
import { createReplay, parseReplayFixture } from '../../../services/app/src/replayCore.ts'
import { persistUserChatTurn } from '../chat/persistUserChatTurn.ts'
import { DEMO_QUESTIONS, eventDelays, installDemoBackend, parseSse, tabStore } from './demoBackend.ts'

test('parseSse reads events the way a browser does', () => {
  assert.deepEqual(parseSse('id: 1\nevent: a\ndata: {"x":1}\n\n: comment\ndata: one\ndata:two\n\nevent: unfinished'), [
    { event: 'a', data: '{"x":1}', id: '1' },
    { event: 'message', data: 'one\ntwo', id: '1' },
  ])
})

test('parseSse yields every event of every recorded stream, in order, each with whole JSON', () => {
  const streams = fixture.exchanges.filter((e) => e.contentType === 'text/event-stream')
  assert.equal(streams.length, 3)
  for (const { body } of streams) {
    const events = parseSse(body)
    assert.deepEqual(events.map((e) => e.event), [...body.matchAll(/^event: (.+)$/gm)].map((m) => m[1]))
    assert.equal(events.filter((e) => e.event === 'turn.completed').length, 1)
    for (const { data } of events) JSON.parse(data)
  }
})

test('eventDelays spreads content over the budget and gives heartbeats no time', () => {
  const ev = (event: string) => ({ event, data: '{}', id: '' })
  assert.deepEqual(eventDelays([ev('a'), ev('heartbeat'), ev('heartbeat'), ev('b')]), [120, 120, 120, 240])
  assert.deepEqual(eventDelays(Array.from({ length: 50 }, () => ev('a'))).slice(0, 2), [50, 100])
})

// This process's sessionStorage reads through `get` while `run` runs.
function withSessionStorage(get: () => Storage | null, run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { get, configurable: true })
  try {
    run()
  } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original)
    else delete (globalThis as { sessionStorage?: Storage }).sessionStorage
  }
}

test('with site data blocked the replay keeps its session in memory, and other storage errors surface', () => {
  withSessionStorage(() => {
    throw new DOMException('Access is denied for this document.', 'SecurityError')
  }, () => assert.equal(tabStore(), undefined))
  withSessionStorage(() => null, () => assert.equal(tabStore(), undefined))
  withSessionStorage(() => {
    throw new TypeError('not a storage failure')
  }, () => assert.throws(tabStore, TypeError))
})

test('a save the tab has no room for drops the saved session, and the request still gets its answer', () => {
  const items = new Map<string, string>()
  let full = false
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      items.set(key, value)
    },
    removeItem: (key: string) => void items.delete(key),
  } as unknown as Storage
  withSessionStorage(() => storage, () => {
    const replay = createReplay(parseReplayFixture(fixture, 'golden-conversation.replay.json'), tabStore())
    assert.equal(replay({ method: 'GET', path: '/v1/chat/threads', query: '', body: '' })?.status, 200)
    assert.equal(items.size, 1)
    full = true
    assert.equal(replay({ method: 'POST', path: '/v1/chat/threads', query: '', body: '{"title":null}' })?.status, 201)
    assert.equal(items.size, 0, 'a reload starts over instead of resuming a session older than the page')
    full = false
    assert.equal(replay({ method: 'GET', path: '/v1/chat/threads', query: '', body: '' })?.status, 200)
    assert.equal(items.size, 1, 'a later save that fits is kept')
  })
  const broken = { setItem: () => { throw new TypeError('not a storage failure') } } as unknown as Storage
  withSessionStorage(() => broken, () => assert.throws(() => tabStore()!.setItem('key', 'value'), TypeError))
})

const items = new Map<string, string>()
installDemoBackend({ getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) })

test('the demo answers a recorded /v1 request in the page', async () => {
  const response = await fetch('http://demo.invalid/v1/chat/threads')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { threads: [] })
})

test('the demo answers each recorded question as the chat client posts it', async () => {
  const demoFetch = globalThis.fetch
  globalThis.fetch = (input, init) => demoFetch(new URL(String(input), 'http://demo.invalid'), init)
  try {
    const thread = fixture.exchanges.find((e) => e.method === 'GET' && e.path.endsWith('/messages'))!.path.split('/').at(-2)!
    for (const content of DEMO_QUESTIONS) {
      const messageId = crypto.randomUUID()
      const message = await persistUserChatTurn({ threadId: thread, userId: '00000000-0000-4000-8000-000000000001', messageId, content })
      assert.deepEqual([message.message_id, message.thread_id, message.role], [messageId, thread, 'user'])
    }
  } finally {
    globalThis.fetch = demoFetch
  }
})

type RecordedMessage = { blocks: Record<string, unknown>[] }

// Every message the demo can show: each turn's sealed answer and each reloaded history.
function recordedMessages(): RecordedMessage[] {
  return fixture.exchanges.flatMap((e) => {
    if (e.contentType === 'text/event-stream') {
      const completed = parseSse(e.body).find((event) => event.event === 'turn.completed')!
      return [(JSON.parse(completed.data) as { message: RecordedMessage }).message]
    }
    return e.method === 'GET' && e.path.endsWith('/messages') ? (JSON.parse(e.body) as { messages: RecordedMessage[] }).messages : []
  })
}

test('every ref a visitor can open from a recorded answer, and every ref its evidence links to, has its evidence recorded', async () => {
  // What the block's figures and its metadata page offer; each evidence page then links on.
  const pending: InspectableBlockRef[] = recordedMessages().flatMap((message) => message.blocks.flatMap((block) => extractInspectableRefs(block)))
  assert.deepEqual(['claim', 'series'].filter((kind) => !pending.some(({ ref }) => ref.kind === kind)), [], 'the recorded answers cite a claim and chart series')
  const opened = new Set<string>()
  const unavailable: string[] = []
  while (pending.length > 0) {
    const { snapshotId, ref } = pending.shift()!
    const key = `${ref.kind} ${ref.id} in snapshot ${snapshotId}`
    if (opened.has(key)) continue
    opened.add(key)
    try {
      const inspection = await fetchEvidenceInspection({
        userId: '00000000-0000-4000-8000-000000000001',
        snapshotId,
        ref,
        fetchImpl: (input, init) => fetch(new URL(String(input), 'http://demo.invalid'), init),
      })
      assert.deepEqual(inspection.ref, ref)
      pending.push(...inspection.related_refs.map(({ kind, id }) => ({ snapshotId: inspection.snapshot_id, ref: { kind, id } })))
    } catch (error) {
      if (!(error instanceof HttpJsonError && error.status === 404)) throw error
      unavailable.push(key)
    }
  }
  assert.deepEqual(unavailable, [])
})

test('the demo answers an off-script request with a 404 that names the recorded questions, not the request', async () => {
  const response = await fetch('http://demo.invalid/v1/market/quotes')
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error:
      "This demo replays one recorded conversation, so it can't answer this. " +
      'In Chat, ask in order: "Analyze NVDA", "Compare it with AMD YTD", "Explain the differences and show the evidence".',
  })
})

// This process's location is at `pathname` while `run` runs, and records where it was sent.
async function withLocation(pathname: string, run: (replaced: string[]) => Promise<void>) {
  const replaced: string[] = []
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', { value: { pathname, replace: (to: string) => replaced.push(to) }, configurable: true })
  try {
    await run(replaced)
  } finally {
    if (original) Object.defineProperty(globalThis, 'location', original)
    else delete (globalThis as { location?: Location }).location
  }
}

const settled = (response: Promise<Response>) =>
  Promise.race([response.then(({ status }) => `answered ${status}`, (error: Error) => `failed ${error.name}`), delay(50, 'unanswered')])

test('a chat whose thread the replay has no recording of starts a new chat, with no error shown meanwhile', async () => {
  const thread = crypto.randomUUID()
  for (const shown of [`/market-agent/chat/${thread}`, `/market-agent/chat/${thread}/`]) {
    await withLocation(shown, async (replaced) => {
      const load = new AbortController()
      const response = fetch(`http://demo.invalid/v1/chat/threads/${thread}/messages`, { signal: load.signal })
      assert.equal(await settled(response), 'unanswered')
      assert.deepEqual(replaced, ['/market-agent/chat'])
      load.abort()
      assert.equal(await settled(response), 'failed AbortError', 'an abort or the history timeout still ends the load')
    })
  }
})

test('a chat whose history is recorded, an off-script question in it, and another thread\'s miss stay on the page', async () => {
  const history = fixture.exchanges.find((e) => e.method === 'GET' && e.path.endsWith('/messages'))!
  const thread = history.path.split('/').at(-2)!
  await withLocation(`/market-agent/chat/${thread}`, async (replaced) => {
    assert.equal(await settled(fetch(`http://demo.invalid${history.path}?${history.query}`)), 'answered 200')
    const offScript = fetch(`http://demo.invalid/v1/chat/threads/${thread}/messages`, { method: 'POST', body: '{"content":"What is the weather?"}' })
    assert.equal(await settled(offScript), 'answered 404')
    assert.equal(await settled(fetch(`http://demo.invalid/v1/chat/threads/${crypto.randomUUID()}/messages`)), 'answered 404')
    assert.deepEqual(replaced, [])
  })
})
