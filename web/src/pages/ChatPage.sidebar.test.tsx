/**
 * Task 6 & 7 — Sidebar tests: New-chat button + per-thread delete
 *
 * Strategy: We test the exported helper functions `createThreadAndOpen` and
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
import { ChatLayout, createThreadAndOpen, deleteThread } from './ChatPage.tsx'

// ── helpers ──────────────────────────────────────────────────────────────────

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
    document?: Document
    window?: Window
  }
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

// ── Task 6: createThreadAndOpen unit test ─────────────────────────────────────

test('createThreadAndOpen: calls POST /v1/chat/threads and navigates', async () => {
  let postedTo: string | undefined
  let postedBody: unknown

  // Stub authenticatedJson by stubbing global fetch (authenticatedJson uses fetch internally)
  const savedFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes('/v1/chat/threads') && init?.method === 'POST') {
      postedTo = url
      postedBody = init.body ? JSON.parse(init.body as string) : undefined
      return new Response(JSON.stringify(NEW_THREAD), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const navigatedTo: string[] = []
    await createThreadAndOpen(USER_ID, (to) => { navigatedTo.push(to) })

    assert.ok(postedTo?.includes('/v1/chat/threads'), 'should POST to /v1/chat/threads')
    assert.deepEqual(postedBody, { title: null }, 'POST body should include title: null')
    assert.equal(navigatedTo.length, 1, 'navigate should be called once')
    assert.equal(navigatedTo[0], `/chat/${NEW_THREAD.thread_id}`, 'should navigate to new thread')
  } finally {
    globalThis.fetch = savedFetch
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
          <MemoryRouter initialEntries={['/chat']}>
            <Routes>
              <Route path="/chat" element={<ChatLayout />} />
            </Routes>
          </MemoryRouter>
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
          <MemoryRouter initialEntries={['/chat']}>
            <Routes>
              <Route path="/chat" element={<ChatLayout />} />
            </Routes>
          </MemoryRouter>
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
