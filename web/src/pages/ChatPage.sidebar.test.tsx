/**
 * Task 6 & 7 — Sidebar tests: New-chat button + per-thread delete
 *
 * Strategy: We test the exported helper functions `createThread` and
 * `deleteThread` directly (unit tests) to avoid React/jsdom synthetic-event
 * delegation issues.  We also render the component to assert the buttons are
 * present in the DOM.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { AuthContext } from '../shell/authTypes.ts'
import { createThread, deleteThread } from '../chat/threadActions.ts'
import { ChatLayout } from './ChatPage.tsx'
import { WithSidebarSlot } from './chatPageHarness.tsx'

// ── helpers ──────────────────────────────────────────────────────────────────

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
    document?: Document
    window?: Window
    ResizeObserver?: typeof ResizeObserver
  }
  const previousResizeObserver = globals.ResizeObserver
  globals.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  const hadActEnv = Object.prototype.hasOwnProperty.call(globals, 'IS_REACT_ACT_ENVIRONMENT')
  const hadDocument = Object.prototype.hasOwnProperty.call(globals, 'document')
  const hadWindow = Object.prototype.hasOwnProperty.call(globals, 'window')
  const previousActEnv = globals.IS_REACT_ACT_ENVIRONMENT
  const previousDocument = globals.document
  const previousWindow = globals.window

  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = domWindow.document
  globals.window = domWindow

  return () => {
    globals.ResizeObserver = previousResizeObserver
    if (hadActEnv) globals.IS_REACT_ACT_ENVIRONMENT = previousActEnv
    else delete globals.IS_REACT_ACT_ENVIRONMENT
    if (hadDocument) globals.document = previousDocument
    else delete globals.document
    if (hadWindow) globals.window = previousWindow
    else delete globals.window
  }
}

const USER_ID = '00000000-0000-4000-8000-000000000001'

function makeAuthContextValue() {
  return {
    session: { userId: USER_ID, displayName: 'Test User' },
    signIn: () => undefined,
    signOut: () => undefined,
  }
}

const THREAD_1 = { thread_id: 'thread-001', title: 'Alpha research', updated_at: '2026-01-01T00:00:00Z' }
const THREAD_2 = { thread_id: 'thread-002', title: null, updated_at: '2026-01-02T00:00:00Z' }
const NEW_THREAD = { thread_id: 'thread-new', title: null, updated_at: '2026-01-03T00:00:00Z' }

test('createThread: POSTs {"title":null} to /v1/chat/threads and returns the thread', async () => {
  const posts: Array<[string, string]> = []
  const savedFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push([String(input), String(init?.body)])
    return new Response(JSON.stringify(NEW_THREAD), { status: 201, headers: { 'content-type': 'application/json' } })
  }

  try {
    const thread = await createThread(USER_ID)
    assert.deepEqual(posts, [['/v1/chat/threads', '{"title":null}']])
    assert.equal(thread.thread_id, 'thread-new')
  } finally {
    globalThis.fetch = savedFetch
  }
})

test('ChatLayout: "+ New chat" goes to the ask-first page without creating a thread', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const savedFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push(`${init?.method ?? 'GET'} ${url}`)
    const body = url === '/v1/chat/threads' ? { threads: [THREAD_1] } : { messages: [] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const container = dom.window.document.getElementById('root')!
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <AuthContext.Provider value={makeAuthContextValue()}>
          <WithSidebarSlot><MemoryRouter initialEntries={['/chat/thread-001']}>
            <Routes>
              <Route path="/chat" element={<ChatLayout />}>
                <Route path=":threadId" />
              </Route>
            </Routes>
          </MemoryRouter></WithSidebarSlot>
        </AuthContext.Provider>,
      )
    })
    assert.equal(container.querySelector('[aria-current="page"]')?.textContent?.startsWith('Alpha research'), true)

    const newChat = [...container.querySelectorAll('button')].find((button) => button.textContent === '+ New chat')!
    await act(async () => newChat.click())

    assert.notEqual(container.querySelector('[data-testid="chat-empty"]'), null)
    assert.equal(container.querySelector('[aria-current="page"]'), null)
    assert.deepEqual(requests.filter((request) => !request.startsWith('GET ')), [])
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = savedFetch
    restoreGlobals()
  }
})

// ── Task 6: ChatLayout renders "+ New chat" button ───────────────────────────

test('ChatLayout: renders "+ New chat" button in sidebar', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const savedFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes('/v1/chat/threads') && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ threads: [THREAD_1, THREAD_2] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const container = dom.window.document.getElementById('root')!
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <AuthContext.Provider value={makeAuthContextValue()}>
          <WithSidebarSlot><MemoryRouter initialEntries={['/chat']}>
            <Routes>
              <Route path="/chat" element={<ChatLayout />} />
            </Routes>
          </MemoryRouter></WithSidebarSlot>
        </AuthContext.Provider>,
      )
    })

    const html = container.innerHTML
    assert.ok(html.includes('New chat'), 'sidebar should contain "+ New chat" button')
    assert.ok(html.includes('Alpha research'), 'thread 1 should appear')

    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = savedFetch
    restoreGlobals()
  }
})

// ── Task 7: deleteThread unit test ────────────────────────────────────────────

test('deleteThread: calls DELETE /v1/chat/threads/:id', async () => {
  let deletedUrl: string | undefined
  const savedFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (init?.method === 'DELETE') {
      deletedUrl = url
      return new Response(null, { status: 200 })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    await deleteThread(USER_ID, 'thread-001')
    assert.ok(deletedUrl?.includes('thread-001'), 'should DELETE /v1/chat/threads/thread-001')
  } finally {
    globalThis.fetch = savedFetch
  }
})

test('deleteThread: treats 404 as success (already gone)', async () => {
  const savedFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('', { status: 404 })
  try {
    // Should not throw
    await deleteThread(USER_ID, 'thread-gone')
  } finally {
    globalThis.fetch = savedFetch
  }
})

test('deleteThread: throws on unexpected error status', async () => {
  const savedFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('', { status: 500 })
  try {
    await assert.rejects(() => deleteThread(USER_ID, 'thread-001'), /HTTP 500/)
  } finally {
    globalThis.fetch = savedFetch
  }
})

// ── Task 7: delete button rendered per thread row ─────────────────────────────

test('ChatLayout: renders delete button for each thread row', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const savedFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes('/v1/chat/threads') && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ threads: [THREAD_1, THREAD_2] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const container = dom.window.document.getElementById('root')!
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <AuthContext.Provider value={makeAuthContextValue()}>
          <WithSidebarSlot><MemoryRouter initialEntries={['/chat']}>
            <Routes>
              <Route path="/chat" element={<ChatLayout />} />
            </Routes>
          </MemoryRouter></WithSidebarSlot>
        </AuthContext.Provider>,
      )
    })

    // Each thread row should have a delete button with aria-label
    const deleteButtons = container.querySelectorAll('button[aria-label^="Delete"]')
    assert.equal(deleteButtons.length, 2, 'should render a delete button for each thread')
    assert.ok(
      (deleteButtons[0] as HTMLElement).getAttribute('aria-label')?.includes('Alpha research'),
      'first delete button should label the thread title',
    )

    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = savedFetch
    restoreGlobals()
  }
})
