import './installDomBeforeReact.ts'

import assert from 'node:assert/strict'
import test from 'node:test'

import { act } from 'react'

import { DELETE_REQUEST_TIMEOUT_MS, forgetThreadDeletes } from '../chat/threadDeletes.ts'
import { ANNOUNCE_CLEAR_MS, ANNOUNCE_DELAY_MS } from '../ui/announcer.ts'
import { FakeServer, deferred, renderChat, TWO_THREADS, type Harness } from './chatPageHarness.tsx'

const announced = (h: Harness, role: 'status' | 'alert') => h.query(`[data-testid="announcer"] [role="${role}"]`)?.textContent

function sidebar(h: Harness): Element {
  const nav = h.query('nav[aria-label="Chats"]')
  assert.ok(nav, 'the chat sidebar is rendered')
  return nav
}

test('while the first list loads the sidebar shows row skeletons, not the empty state', async () => {
  const server = new FakeServer()
  const list = deferred<{ body: unknown }>()
  server.listReply = () => list.promise
  const h = await renderChat('/chat', server)
  try {
    assert.equal(sidebar(h).textContent, '+ New chatChatsLoading chats')
    assert.equal(sidebar(h).querySelector('span[role="status"]')?.textContent, 'Loading chats')

    await act(async () => list.resolve({ body: { threads: [] } }))
    await h.flush()
    assert.equal(sidebar(h).textContent, '+ New chatChatsNo chats yet.')
  } finally {
    await h.cleanup()
  }
})

test('a failed first list load says so, keeps the reason in details, and Retry reloads it', async () => {
  const server = new FakeServer()
  let reads = 0
  server.listReply = () => (++reads === 1 ? { status: 502, body: { error: 'bad gateway' } } : { body: { threads: TWO_THREADS } })
  const h = await renderChat('/chat', server)
  try {
    assert.equal(sidebar(h).textContent, "+ New chatChatsCouldn't load your chats.RetryDetailsHTTP 502")
    await act(() => new Promise((resolve) => setTimeout(resolve, ANNOUNCE_DELAY_MS)))
    assert.equal(announced(h, 'status'), "Couldn't load your chats.")

    await act(async () => h.button('Retry').click())
    await h.flush()
    assert.equal(server.gets('/v1/chat/threads'), 2)
    assert.deepEqual([...sidebar(h).querySelectorAll('a span:first-child')].map((span) => span.textContent), ['Chips', 'Rates'])
  } finally {
    await h.cleanup()
  }
})

test('Retry swaps the failure for loading rows while the list reloads', async () => {
  const server = new FakeServer()
  const second = deferred<{ body: unknown }>()
  let reads = 0
  server.listReply = () => (++reads === 1 ? { status: 503, body: {} } : second.promise)
  const h = await renderChat('/chat', server)
  try {
    assert.equal(sidebar(h).textContent, "+ New chatChatsCouldn't load your chats.RetryDetailsHTTP 503")

    await act(async () => h.button('Retry').click())
    await h.flush()
    assert.equal(sidebar(h).textContent, '+ New chatChatsLoading chats')

    await act(async () => second.resolve({ body: { threads: TWO_THREADS } }))
    await h.flush()
    assert.deepEqual([...sidebar(h).querySelectorAll('a span:first-child')].map((span) => span.textContent), ['Chips', 'Rates'])
  } finally {
    await h.cleanup()
  }
})

const UNDO_MS = 5000
const DELETE_T1: [string, string, string] = ['DELETE', '/v1/chat/threads/T1', '']
const DELETE_T2: [string, string, string] = ['DELETE', '/v1/chat/threads/T2', '']

function shownChats(h: Harness): string[] {
  return [...sidebar(h).querySelectorAll('a span:first-child')].map((span) => span.textContent ?? '')
}

async function chatsWithTwoThreads(path = '/chat'): Promise<{ h: Harness; server: FakeServer }> {
  const server = new FakeServer()
  server.threads = [...TWO_THREADS]
  return { h: await renderChat(path, server), server }
}

async function tick(h: Harness, t: test.TestContext, ms: number): Promise<void> {
  await act(async () => t.mock.timers.tick(ms))
  await h.flush()
}

test('delete hides the row at once, and Undo restores it without a DELETE', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads()
  try {
    await act(async () => h.button('Delete Chips').click())
    assert.deepEqual(shownChats(h), ['Rates'])
    assert.match(sidebar(h).textContent ?? '', /Chat deleted\.Undo/)

    await act(async () => h.button('Undo').click())
    assert.deepEqual(shownChats(h), ['Chips', 'Rates'])
    await tick(h, t, UNDO_MS * 2)
    assert.deepEqual(server.writes(), [])
  } finally {
    await h.cleanup()
  }
})

test('delete announces "Chat deleted." through the app announcer and focuses Undo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h } = await chatsWithTwoThreads()
  try {
    await act(async () => h.button('Delete Chips').click())
    assert.equal(h.dom.window.document.activeElement?.getAttribute('aria-label'), 'Undo deleting Chips')

    await tick(h, t, ANNOUNCE_DELAY_MS)
    assert.equal(announced(h, 'status'), 'Chat deleted.')
  } finally {
    await h.cleanup()
  }
})

test('an Undo before "Chat deleted." is spoken withdraws it, and so does signing out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h } = await chatsWithTwoThreads()
  try {
    await act(async () => h.button('Delete Chips').click())
    await act(async () => h.button('Undo').click())
    await tick(h, t, ANNOUNCE_DELAY_MS)
    assert.equal(announced(h, 'status'), '')

    await act(async () => h.button('Delete Chips').click())
    await act(async () => forgetThreadDeletes())
    await tick(h, t, ANNOUNCE_DELAY_MS)
    assert.equal(announced(h, 'status'), '')
  } finally {
    await h.cleanup()
  }
})

function focused(h: Harness): string {
  const element = h.dom.window.document.activeElement
  if (element === null || element.tagName === 'BODY') return 'BODY'
  return element?.getAttribute('aria-label') ?? element?.querySelector('span')?.textContent ?? element?.textContent ?? ''
}

test('Undo puts focus on the restored chat link', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h } = await chatsWithTwoThreads()
  try {
    await act(async () => h.button('Delete Chips').click())
    assert.equal(focused(h), 'Undo deleting Chips')

    await act(async () => h.button('Undo').click())
    assert.equal(focused(h), 'Chips')
  } finally {
    await h.cleanup()
  }
})

test('the undo window elapsing moves focus from Undo to the next chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h } = await chatsWithTwoThreads()
  try {
    await act(async () => h.button('Delete Chips').click())
    await tick(h, t, UNDO_MS)
    assert.equal(focused(h), 'Rates')
  } finally {
    await h.cleanup()
  }
})

test('the undo window elapsing on the last chat moves focus to New chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const server = new FakeServer()
  server.threads = [TWO_THREADS[0]]
  const h = await renderChat('/chat', server)
  try {
    await act(async () => h.button('Delete Chips').click())
    await tick(h, t, UNDO_MS)
    assert.equal(focused(h), '+ New chat')
  } finally {
    await h.cleanup()
  }
})

test('a second delete clicked without moving focus leaves focus on the new Undo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h } = await chatsWithTwoThreads()
  try {
    await act(async () => h.button('Delete Chips').click())
    assert.equal(focused(h), 'Undo deleting Chips')

    await act(async () => h.button('Delete Rates').click())
    await h.flush()
    assert.equal(focused(h), 'Undo deleting Rates')
  } finally {
    await h.cleanup()
  }
})

test('the undo window elapsing leaves focus alone once it has left Undo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h } = await chatsWithTwoThreads()
  try {
    await act(async () => h.button('Delete Chips').click())
    const composer = h.query('textarea') as HTMLTextAreaElement
    composer.focus()
    await tick(h, t, UNDO_MS)
    assert.equal(h.dom.window.document.activeElement?.tagName, 'TEXTAREA')
  } finally {
    await h.cleanup()
  }
})

test('the undo window elapsing sends exactly one DELETE and drops the chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads()
  try {
    await act(async () => h.button('Delete Chips').click())
    await tick(h, t, UNDO_MS - 1)
    assert.deepEqual(server.writes(), [])

    await tick(h, t, 1)
    await tick(h, t, UNDO_MS * 2)
    assert.deepEqual(server.writes(), [DELETE_T1])
    assert.deepEqual(shownChats(h), ['Rates'])
    assert.doesNotMatch(sidebar(h).textContent ?? '', /Chat deleted/)
  } finally {
    await h.cleanup()
  }
})

test('a second delete sends the first at once and keeps its own undo window', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads()
  try {
    await act(async () => h.button('Delete Chips').click())
    await tick(h, t, 1000)
    await act(async () => h.button('Delete Rates').click())
    await h.flush()
    assert.deepEqual(server.writes(), [DELETE_T1])

    await tick(h, t, UNDO_MS - 500)
    assert.deepEqual(server.writes(), [DELETE_T1])
    assert.equal(h.button('Undo').getAttribute('aria-label'), 'Undo deleting Rates')

    await tick(h, t, 500)
    await tick(h, t, UNDO_MS * 2)
    assert.deepEqual(server.writes(), [DELETE_T1, DELETE_T2])
    assert.equal(sidebar(h).textContent, '+ New chatChatsNo chats yet.')
  } finally {
    await h.cleanup()
  }
})

test('deleting the open chat while another delete is pending keeps the open chat\'s undo window', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads('/chat/T1')
  try {
    await act(async () => h.button('Delete Rates').click())
    await act(async () => h.button('Delete Chips').click())
    await h.flush()
    assert.equal(h.path(), '/chat')
    assert.equal(h.button('Undo').getAttribute('aria-label'), 'Undo deleting Chips')
    assert.deepEqual(server.writes(), [DELETE_T2])

    await tick(h, t, UNDO_MS)
    await tick(h, t, UNDO_MS)
    assert.deepEqual(server.writes(), [DELETE_T2, DELETE_T1])
  } finally {
    await h.cleanup()
  }
})

test('collapsing the sidebar keeps the pending delete and its deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads('/chat/T2')
  try {
    await act(async () => h.button('Delete Chips').click())
    await act(async () => h.button('Collapse sidebar').click())
    await h.flush()
    assert.deepEqual(server.writes(), [])

    await act(async () => h.button('Expand sidebar').click())
    assert.equal(h.button('Undo').getAttribute('aria-label'), 'Undo deleting Chips')
    await tick(h, t, UNDO_MS)
    await tick(h, t, UNDO_MS)
    assert.deepEqual(server.writes(), [DELETE_T1])
  } finally {
    await h.cleanup()
  }
})

test('leaving and coming back while the DELETE is in flight keeps the chat hidden until the list drops it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads()
  const held = deferred<{ body: unknown }>()
  server.deleteReply = () => held.promise
  try {
    await act(async () => h.button('Delete Chips').click())
    await h.navigate('/home')
    await tick(h, t, UNDO_MS)
    assert.deepEqual(server.writes(), [DELETE_T1])

    await h.navigate('/chat')
    assert.deepEqual(shownChats(h), ['Rates'])

    server.threads = server.threads.filter((thread) => thread.thread_id !== 'T1')
    await act(async () => held.resolve({ body: {} }))
    await h.flush()
    assert.equal(server.gets('/v1/chat/threads'), 3)
    assert.deepEqual(shownChats(h), ['Rates'])
    await tick(h, t, UNDO_MS * 2)
    assert.deepEqual(server.writes(), [DELETE_T1])
  } finally {
    await h.cleanup()
  }
})

test('Back to a chat deleted while open reopens it and cancels the delete', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const server = new FakeServer()
  server.threads = [...TWO_THREADS]
  const h = await renderChat('/home', server)
  try {
    await h.navigate('/chat/T1')
    await act(async () => h.button('Delete Chips').click())
    await h.flush()
    assert.equal(h.path(), '/chat')

    await h.back()
    assert.equal(h.path(), '/chat/T1')
    assert.deepEqual(shownChats(h), ['Chips', 'Rates'])
    await tick(h, t, UNDO_MS * 2)
    assert.deepEqual(server.writes(), [])
  } finally {
    await h.cleanup()
  }
})

test('Back to a chat whose delete already went out lands on /chat instead of a dead chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const server = new FakeServer()
  server.threads = [...TWO_THREADS]
  const h = await renderChat('/home', server)
  try {
    await h.navigate('/chat/T1')
    await act(async () => h.button('Delete Chips').click())
    await tick(h, t, UNDO_MS + 1000)
    assert.deepEqual(server.writes(), [DELETE_T1])
    server.history = () => ({ status: 404, body: { error: 'not found' } })

    await h.back()
    assert.equal(h.path(), '/chat')
    assert.deepEqual(shownChats(h), ['Rates'])
    assert.doesNotMatch(h.text(), /Couldn't load this chat\./)
  } finally {
    await h.cleanup()
  }
})

test('opening the chat that is pending delete cancels the delete', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads('/chat/T2')
  try {
    await act(async () => h.button('Delete Chips').click())
    await h.navigate('/chat/T1')
    assert.deepEqual(shownChats(h), ['Chips', 'Rates'])
    assert.doesNotMatch(sidebar(h).textContent ?? '', /Chat deleted/)

    await tick(h, t, UNDO_MS * 2)
    assert.deepEqual(server.writes(), [])
  } finally {
    await h.cleanup()
  }
})

test('a failed delete restores the row and says it could not delete', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads()
  server.deleteReply = () => ({ status: 500, body: { error: 'boom' } })
  try {
    await act(async () => h.button('Delete Chips').click())
    await tick(h, t, UNDO_MS)
    await tick(h, t, ANNOUNCE_DELAY_MS)
    assert.deepEqual(shownChats(h), ['Chips', 'Rates'])
    assert.equal(announced(h, 'alert'), "Couldn't delete the chat.")
    assert.equal(announced(h, 'status'), 'Chat deleted.', 'the visible notice does not announce it a second time')
    assert.match(sidebar(h).textContent ?? '', /Couldn't delete the chat\.DetailsHTTP 500Chats/)
    assert.deepEqual(server.writes(), [DELETE_T1])
  } finally {
    await h.cleanup()
  }
})

test('a delete error is gone once the list re-reads, and stays gone when the sidebar remounts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads()
  server.deleteReply = () => ({ status: 500, body: { error: 'boom' } })
  server.createdThreadId = 'T3'
  try {
    await act(async () => h.button('Delete Chips').click())
    await tick(h, t, UNDO_MS)
    assert.match(sidebar(h).textContent ?? '', /Couldn't delete the chat\./)
    const reads = server.gets('/v1/chat/threads')

    await h.ask('Analyze NVDA')
    assert.equal(server.gets('/v1/chat/threads'), reads + 1)
    assert.doesNotMatch(sidebar(h).textContent ?? '', /Couldn't delete/)

    await act(async () => h.button('Collapse sidebar').click())
    await act(async () => h.button('Expand sidebar').click())
    assert.doesNotMatch(sidebar(h).textContent ?? '', /Couldn't delete/)
  } finally {
    await h.cleanup()
  }
})

test('a list read already in flight when the delete fails leaves the delete error up', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads()
  server.deleteReply = () => ({ status: 500, body: { error: 'boom' } })
  server.createdThreadId = 'T3'
  const held = deferred<{ body: unknown }>()
  try {
    await act(async () => h.button('Delete Chips').click())
    const reads = server.gets('/v1/chat/threads')
    server.listReply = () => server.gets('/v1/chat/threads') === reads + 1 ? held.promise : { body: { threads: server.threads } }
    await h.ask('Analyze NVDA')
    assert.equal(server.gets('/v1/chat/threads'), reads + 1)

    await tick(h, t, UNDO_MS)
    assert.equal(server.gets('/v1/chat/threads'), reads + 2, 'the failed DELETE is checked against the list')
    assert.match(sidebar(h).textContent ?? '', /Couldn't delete the chat\./)

    await act(async () => held.resolve({ body: { threads: server.threads } }))
    await h.flush()
    assert.equal(server.gets('/v1/chat/threads'), reads + 2)
    assert.match(sidebar(h).textContent ?? '', /Couldn't delete the chat\.DetailsHTTP 500Chats/)
  } finally {
    await h.cleanup()
  }
})

test('a delete that fails while the sidebar is collapsed is announced, and the sidebar shows it without announcing again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads('/chat/T2')
  server.deleteReply = () => ({ status: 500, body: { error: 'boom' } })
  try {
    await act(async () => h.button('Delete Chips').click())
    await act(async () => h.button('Collapse sidebar').click())
    await tick(h, t, UNDO_MS)
    await tick(h, t, ANNOUNCE_DELAY_MS)
    assert.equal(announced(h, 'alert'), "Couldn't delete the chat.")
    await tick(h, t, ANNOUNCE_CLEAR_MS)
    assert.deepEqual([announced(h, 'status'), announced(h, 'alert')], ['', ''])

    await act(async () => h.button('Expand sidebar').click())
    await tick(h, t, ANNOUNCE_DELAY_MS)
    assert.deepEqual([announced(h, 'status'), announced(h, 'alert')], ['', ''])
    assert.match(sidebar(h).textContent ?? '', /Couldn't delete the chat\.DetailsHTTP 500Chats/)
  } finally {
    await h.cleanup()
  }
})

test('a timed-out DELETE whose chat is gone from the list counts as deleted: no error, and the row stays hidden', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads('/chat/T2')
  server.deleteReply = (threadId) => {
    server.threads = server.threads.filter((thread) => thread.thread_id !== threadId)
    return { status: 504, body: {} }
  }
  try {
    await act(async () => h.button('Delete Chips').click())
    const reads = server.gets('/v1/chat/threads')
    await tick(h, t, UNDO_MS)
    await tick(h, t, ANNOUNCE_DELAY_MS)
    assert.equal(server.gets('/v1/chat/threads'), reads + 2, 'one read checks the DELETE, one re-reads the settled list')
    assert.deepEqual(shownChats(h), ['Rates'])
    assert.doesNotMatch(sidebar(h).textContent ?? '', /Couldn't delete/)
    assert.equal(announced(h, 'alert'), '')

    await h.navigate('/chat/T1')
    assert.equal(h.path(), '/chat')
    assert.deepEqual(shownChats(h), ['Rates'])
  } finally {
    await h.cleanup()
  }
})

test('a timed-out DELETE whose chat is still listed restores the row and says it could not delete', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads('/chat/T2')
  server.deleteReply = () => ({ status: 504, body: {} })
  try {
    await act(async () => h.button('Delete Chips').click())
    await act(async () => h.button('Collapse sidebar').click())
    const reads = server.gets('/v1/chat/threads')
    await tick(h, t, UNDO_MS)
    await tick(h, t, ANNOUNCE_DELAY_MS)
    assert.equal(server.gets('/v1/chat/threads'), reads + 1, 'the store re-reads the list once to check')
    assert.equal(announced(h, 'alert'), "Couldn't delete the chat.")

    await act(async () => h.button('Expand sidebar').click())
    await h.flush()
    assert.deepEqual(shownChats(h), ['Chips', 'Rates'])
    assert.match(sidebar(h).textContent ?? '', /Couldn't delete the chat\.DetailsHTTP 504Chats/)
  } finally {
    await h.cleanup()
  }
})

test('a failed DELETE whose check cannot read the list counts as failed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads()
  server.deleteReply = () => ({ status: 504, body: {} })
  try {
    await act(async () => h.button('Delete Chips').click())
    server.listReply = () => ({ status: 503, body: {} })
    await tick(h, t, UNDO_MS)
    await tick(h, t, ANNOUNCE_DELAY_MS)
    assert.deepEqual(shownChats(h), ['Chips', 'Rates'])
    assert.equal(announced(h, 'alert'), "Couldn't delete the chat.")
  } finally {
    await h.cleanup()
  }
})

test('a failed DELETE whose check never answers counts as failed once the check times out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads()
  server.deleteReply = () => ({ status: 504, body: {} })
  try {
    await act(async () => h.button('Delete Chips').click())
    server.listReply = () => new Promise(() => {})
    await tick(h, t, UNDO_MS)
    await tick(h, t, DELETE_REQUEST_TIMEOUT_MS - 1)
    assert.deepEqual(shownChats(h), ['Rates'])

    await tick(h, t, 1)
    await tick(h, t, ANNOUNCE_DELAY_MS)
    assert.deepEqual(shownChats(h), ['Chips', 'Rates'])
    assert.equal(announced(h, 'alert'), "Couldn't delete the chat.")
  } finally {
    await h.cleanup()
  }
})

test('a DELETE that never answers is checked once it times out, and fails if the chat is still listed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads()
  server.deleteReply = () => new Promise(() => {})
  try {
    await act(async () => h.button('Delete Chips').click())
    await tick(h, t, UNDO_MS)
    const reads = server.gets('/v1/chat/threads')
    await tick(h, t, DELETE_REQUEST_TIMEOUT_MS - 1)
    assert.deepEqual(shownChats(h), ['Rates'])

    await tick(h, t, 1)
    await tick(h, t, ANNOUNCE_DELAY_MS)
    assert.equal(server.gets('/v1/chat/threads'), reads + 1, 'the store re-reads the list once to check')
    assert.deepEqual(shownChats(h), ['Chips', 'Rates'])
    assert.equal(announced(h, 'alert'), "Couldn't delete the chat.")
    assert.match(sidebar(h).textContent ?? '', /Couldn't delete the chat\.DetailsTimed out\.Chats/)
  } finally {
    await h.cleanup()
  }
})

test('signing out while a failed DELETE is being checked drops the result', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { h, server } = await chatsWithTwoThreads()
  server.deleteReply = () => ({ status: 504, body: {} })
  const check = deferred<{ body: unknown }>()
  try {
    await act(async () => h.button('Delete Chips').click())
    server.listReply = () => check.promise
    await tick(h, t, UNDO_MS)
    await act(async () => forgetThreadDeletes())

    await act(async () => check.resolve({ body: { threads: server.threads } }))
    await h.flush()
    await tick(h, t, ANNOUNCE_DELAY_MS)
    assert.doesNotMatch(sidebar(h).textContent ?? '', /Couldn't delete/)
    assert.equal(announced(h, 'alert'), '')
  } finally {
    await h.cleanup()
  }
})

test('an unsent question stays with its own thread', async () => {
  const { h } = await chatsWithTwoThreads('/chat/T1')
  const composer = () => h.query('textarea') as HTMLTextAreaElement
  try {
    await h.type('Half-typed question about chips')
    await h.navigate('/chat/T2')
    assert.equal(composer().value, '', 'another thread starts empty')

    await h.navigate('/chat/T1')
    assert.equal(composer().value, 'Half-typed question about chips', 'the draft comes back with its thread')

    await h.ask('Sent question about chips')
    await h.navigate('/chat/T2')
    await h.navigate('/chat/T1')
    assert.equal(composer().value, '', 'a sent question leaves no draft behind')
  } finally {
    await h.cleanup()
  }
})
