import './installDomBeforeReact.ts'

import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

import { act } from 'react'

import { FakeEventSource, FakeServer, renderChat, threadRead, type Harness } from './chatPageHarness.tsx'

const QUESTION = 'Analyze MU'

async function answering(server: FakeServer): Promise<{ h: Harness; own: FakeEventSource }> {
  server.history = (id) => threadRead(server.posted.size === 0 ? [] : [server.postedUser(id)])
  const h = await renderChat('/chat/T1', server)
  await h.ask(QUESTION)
  const own = FakeEventSource.instances.at(-1)!
  await act(async () => own.emit('turn.started', 1))
  await h.flush()
  return { h, own }
}

const click = async (h: Harness, name: string) => {
  await act(async () => h.button(name).click())
  await h.flush()
}

const stopRequests = (server: FakeServer) => server.writes().filter(([method, path]) => method === 'POST' && path.includes('/stop'))

test('while the analyst answers Send is Stop, the composer stays typable, and a stop ends in a quiet Stopped notice under the question', async () => {
  const server = new FakeServer()
  const { h, own } = await answering(server)
  try {
    assert.equal(h.sendable(), false)
    assert.equal(h.button('Stop generation').disabled, false)
    await h.type('next question')
    assert.equal((h.query('textarea') as HTMLTextAreaElement).value, 'next question')

    await click(h, 'Stop generation')
    const runId = own.params.get('run_id')!
    const turnId = own.params.get('turn_id')!
    assert.deepEqual(stopRequests(server), [['POST', `/v1/chat/threads/T1/runs/${runId}/stop?turn_id=${turnId}`, '']])
    assert.equal(h.button('Stopping').disabled, true)

    await act(async () => own.emit('turn.stopped', 2))
    await h.flush()
    assert.equal(own.closed, true)
    assert.ok(h.query('[data-testid="stopped-turn"]'))
    assert.match(h.text(), /Stopped/)
    assert.match(h.text(), new RegExp(QUESTION))
    assert.equal(h.query('[aria-label="Stopping"]'), null)
    assert.equal(h.sendable(), true)
    assert.equal((h.query('textarea') as HTMLTextAreaElement).value, 'next question')
  } finally {
    await h.cleanup()
  }
})

test('Ask again after a stop runs the same question as a new run of the same turn', async () => {
  const server = new FakeServer()
  const { h, own } = await answering(server)
  try {
    await click(h, 'Stop generation')
    await act(async () => own.emit('turn.stopped', 2))
    await h.flush()

    await click(h, 'Ask again')
    const again = FakeEventSource.instances.at(-1)!
    assert.notEqual(again, own)
    assert.notEqual(again.params.get('run_id'), own.params.get('run_id'))
    assert.equal(again.params.get('turn_id'), own.params.get('turn_id'))
    assert.equal(again.params.get('user_intent'), QUESTION)
    assert.equal(again.params.get('attach'), null)
    assert.equal(h.query('[data-testid="stopped-turn"]'), null)
    assert.equal(h.button('Stop generation').disabled, false)
  } finally {
    await h.cleanup()
  }
})

test('a stop that fails gives the Stop button back, and so does one the stream never confirms', async () => {
  const server = new FakeServer()
  server.stopReply = () => ({ status: 500, body: { error: 'boom' } })
  const { h } = await answering(server)
  try {
    await click(h, 'Stop generation')
    assert.equal(h.button('Stop generation').disabled, false)

    server.stopReply = () => ({ body: { status: 'stopped' } })
    mock.timers.enable({ apis: ['setTimeout'] })
    await click(h, 'Stop generation')
    assert.equal(h.button('Stopping').disabled, true)
    await act(async () => mock.timers.tick(10_000))
    await h.flush()
    assert.equal(h.button('Stop generation').disabled, false)
    assert.equal(stopRequests(server).length, 2)
  } finally {
    mock.timers.reset()
    await h.cleanup()
  }
})

test('a stop refused because the answer is being saved stays Stopping until the answer lands', async () => {
  const server = new FakeServer()
  server.stopReply = () => ({ status: 409, body: { status: 'saving', error: 'the turn is saving its answer' } })
  const { h } = await answering(server)
  try {
    await click(h, 'Stop generation')
    assert.equal(h.button('Stopping').disabled, true)
  } finally {
    await h.cleanup()
  }
})
