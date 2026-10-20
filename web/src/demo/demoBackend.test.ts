import assert from 'node:assert/strict'
import test from 'node:test'

import fixture from '../../../services/app/fixtures/golden-conversation.replay.json'
import { extractInspectableRefs, type InspectableBlockRef } from '../evidence/inspectableRefs.ts'
import { fetchEvidenceInspection } from '../evidence/inspectionClient.ts'
import { HttpJsonError } from '../http/authFetch.ts'
import { installDemoBackend, parseSse } from './demoBackend.ts'

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
