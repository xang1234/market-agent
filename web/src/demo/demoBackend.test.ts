import assert from 'node:assert/strict'
import test from 'node:test'

import fixture from '../../../services/app/fixtures/golden-conversation.replay.json'
import { extractInspectableRefs, type InspectableBlockRef } from '../evidence/inspectableRefs.ts'
import { fetchEvidenceInspection } from '../evidence/inspectionClient.ts'
import { HttpJsonError } from '../http/authFetch.ts'
import { createReplay, parseReplayFixture } from '../../../services/app/src/replayCore.ts'
import { eventDelays, installDemoBackend, parseSse, tabStore } from './demoBackend.ts'

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
function withSessionStorage(get: () => Storage, run: () => void) {
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
  assert.ok(pending.some(({ ref }) => ref.kind === 'fact'), 'the recorded answers cite facts')
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

test('the demo answers an off-script request with a 404 that names the recorded questions', async () => {
  const response = await fetch('http://demo.invalid/v1/market/quotes')
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error:
      'This demo replays one recorded conversation, so it has no answer for GET /v1/market/quotes. ' +
      'In Chat, ask in order: "Analyze NVDA", "Compare it with AMD YTD", "Explain the differences and show the evidence".',
  })
})
