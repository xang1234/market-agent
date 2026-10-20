import assert from 'node:assert/strict'
import test from 'node:test'

import fixture from '../../../services/app/fixtures/golden-conversation.replay.json'
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

test('the demo answers an off-script request with a 404 that names the recorded questions', async () => {
  const response = await fetch('http://demo.invalid/v1/market/quotes')
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error:
      'This demo replays one recorded conversation, so it has no answer for GET /v1/market/quotes. ' +
      'In Chat, ask in order: "Analyze NVDA", "Compare it with AMD YTD", "Explain the differences and show the evidence".',
  })
})
