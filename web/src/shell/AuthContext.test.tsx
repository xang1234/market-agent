import '../pages/installDomBeforeReact.ts'

import assert from 'node:assert/strict'
import test from 'node:test'

import { act, useContext } from 'react'
import { createRoot } from 'react-dom/client'

import { JSDOM } from 'jsdom'

import { writeDraft } from '../chat/composerDrafts.ts'
import { startThreadDelete, UNDO_DELETE_MS } from '../chat/threadDeletes.ts'
import { AuthProvider } from './AuthContext.tsx'
import { AuthContext, DEFAULT_MOCK_SESSION, type AuthContextValue } from './authTypes.ts'

test('signing out drops a pending chat delete instead of sending it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = async (input, init) => {
    requests.push(`${init?.method ?? 'GET'} ${String(input)}`)
    return new Response('{}', { status: 200 })
  }
  let auth: AuthContextValue | null = null
  function Probe() {
    auth = useContext(AuthContext)
    return null
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<AuthProvider initialSession={DEFAULT_MOCK_SESSION}><Probe /></AuthProvider>))
    startThreadDelete(DEFAULT_MOCK_SESSION.userId, 'T1', 'Chips')
    await act(async () => auth!.signOut())
    t.mock.timers.tick(UNDO_DELETE_MS * 2)
    await act(async () => new Promise((resolve) => setImmediate(resolve)))
    assert.deepEqual(requests, [])

    startThreadDelete(DEFAULT_MOCK_SESSION.userId, 'T2', 'Rates')
    t.mock.timers.tick(UNDO_DELETE_MS)
    await act(async () => new Promise((resolve) => setImmediate(resolve)))
    assert.deepEqual(requests, ['DELETE /v1/chat/threads/T2'])
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = originalFetch
  }
})

test('signing out leaves no unsent chat draft behind', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const storage = new JSDOM('', { url: 'http://localhost/' }).window.localStorage
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  let auth: AuthContextValue | null = null
  function Probe() {
    auth = useContext(AuthContext)
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<AuthProvider initialSession={DEFAULT_MOCK_SESSION}><Probe /></AuthProvider>))
    writeDraft(`${DEFAULT_MOCK_SESSION.userId}:T1`, 'A question about chips')
    storage.setItem('theme', 'dark')

    await act(async () => auth!.signOut())

    assert.equal(storage.getItem(`chat-draft:${DEFAULT_MOCK_SESSION.userId}:T1`), null)
    assert.equal(storage.getItem('theme'), 'dark', 'other settings stay')
  } finally {
    await act(async () => root.unmount())
    delete (window as { localStorage?: Storage }).localStorage
  }
})
