/**
 * Task 5 — Enter-to-send composer tests
 *
 * Strategy:
 *  1. Unit-test the exported `handleComposerKeyDownEvent` function directly
 *     (avoids React/jsdom synthetic-event delegation issues).
 *  2. Render `ChatThreadView` in jsdom to assert the hint text is present.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { AuthContext } from '../shell/authTypes.ts'
import { ChatThreadView, handleComposerKeyDownEvent } from './ChatPage.tsx'

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

// ── unit tests for the handler (no React rendering needed) ───────────────────

/**
 * Build a minimal synthetic React keyboard event object that mimics
 * what React passes to `onKeyDown` handlers.
 */
function makeSyntheticKeyEvent(opts: {
  key: string
  shiftKey?: boolean
  isComposing?: boolean
  form?: HTMLFormElement | null
  textarea?: HTMLTextAreaElement
}): React.KeyboardEvent<HTMLTextAreaElement> {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const textarea = opts.textarea ?? dom.window.document.createElement('textarea')
  if (opts.form) opts.form.appendChild(textarea)

  let prevented = false
  const nativeEvent = new dom.window.KeyboardEvent('keydown', {
    key: opts.key,
    shiftKey: opts.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(nativeEvent, 'isComposing', { value: opts.isComposing ?? false })

  return {
    key: opts.key,
    shiftKey: opts.shiftKey ?? false,
    nativeEvent: nativeEvent as unknown as KeyboardEvent,
    preventDefault: () => { prevented = true },
    currentTarget: textarea,
    _prevented: () => prevented,
  } as unknown as React.KeyboardEvent<HTMLTextAreaElement> & { _prevented: () => boolean }
}

test('handleComposerKeyDownEvent: Enter (no shift) calls requestSubmit and prevents default', () => {
  const dom = new JSDOM('<!doctype html><html><body><form></form></body></html>')
  const form = dom.window.document.querySelector('form')!
  const textarea = dom.window.document.createElement('textarea')
  form.appendChild(textarea)

  let submitCalls = 0
  form.addEventListener('submit', (e) => { e.preventDefault(); submitCalls++ })

  const event = makeSyntheticKeyEvent({ key: 'Enter', shiftKey: false, form, textarea })
  handleComposerKeyDownEvent(event)

  assert.equal(submitCalls, 1, 'requestSubmit should fire the submit event')
  assert.equal((event as unknown as { _prevented: () => boolean })._prevented(), true, 'preventDefault should be called')
})

test('handleComposerKeyDownEvent: Shift+Enter does NOT call requestSubmit', () => {
  const dom = new JSDOM('<!doctype html><html><body><form></form></body></html>')
  const form = dom.window.document.querySelector('form')!
  const textarea = dom.window.document.createElement('textarea')
  form.appendChild(textarea)

  let submitCalls = 0
  form.addEventListener('submit', (e) => { e.preventDefault(); submitCalls++ })

  const event = makeSyntheticKeyEvent({ key: 'Enter', shiftKey: true, form, textarea })
  handleComposerKeyDownEvent(event)

  assert.equal(submitCalls, 0, 'Shift+Enter should not trigger submit')
})

test('handleComposerKeyDownEvent: composing (IME) Enter does NOT call requestSubmit', () => {
  const dom = new JSDOM('<!doctype html><html><body><form></form></body></html>')
  const form = dom.window.document.querySelector('form')!
  const textarea = dom.window.document.createElement('textarea')
  form.appendChild(textarea)

  let submitCalls = 0
  form.addEventListener('submit', (e) => { e.preventDefault(); submitCalls++ })

  const event = makeSyntheticKeyEvent({ key: 'Enter', shiftKey: false, isComposing: true, form, textarea })
  handleComposerKeyDownEvent(event)

  assert.equal(submitCalls, 0, 'Composing Enter should not trigger submit')
})

test('handleComposerKeyDownEvent: non-Enter key does nothing', () => {
  const dom = new JSDOM('<!doctype html><html><body><form></form></body></html>')
  const form = dom.window.document.querySelector('form')!
  const textarea = dom.window.document.createElement('textarea')
  form.appendChild(textarea)

  let submitCalls = 0
  form.addEventListener('submit', (e) => { e.preventDefault(); submitCalls++ })

  const event = makeSyntheticKeyEvent({ key: 'a', shiftKey: false, form, textarea })
  handleComposerKeyDownEvent(event)

  assert.equal(submitCalls, 0, 'Non-Enter key should not trigger submit')
  assert.equal((event as unknown as { _prevented: () => boolean })._prevented(), false, 'preventDefault should not be called')
})

// ── render tests ──────────────────────────────────────────────────────────────

test('ChatThreadView: renders hint text below the composer', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const savedFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ messages: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  try {
    const container = dom.window.document.getElementById('root')!
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <AuthContext.Provider value={makeAuthContextValue()}>
          <MemoryRouter initialEntries={['/chat/THREAD-1']}>
            <Routes>
              <Route path="/chat/:threadId" element={<ChatThreadView />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>,
      )
    })
    const html = container.innerHTML
    assert.ok(html.includes('Enter'), 'hint should mention Enter key')
    assert.ok(html.includes('Shift'), 'hint should mention Shift+Enter')
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = savedFetch
    restoreGlobals()
  }
})
