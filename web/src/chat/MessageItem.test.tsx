import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { EvidenceInspectorProvider } from '../evidence/EvidenceInspectorProvider.tsx'
import { AuthContext } from '../shell/authTypes.ts'
import { BlockRegistryProvider, createDefaultBlockRegistry } from '../blocks/index.ts'
import type { RichTextBlock, TableBlock } from '../blocks/types.ts'
import type { ChatMessage } from './messageTypes.ts'
import { MessageItem } from './MessageItem.tsx'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const SNAPSHOT_ID = '11111111-1111-4111-8111-111111111111'

// A minimal rich_text block (prose — should get max-w-[820px])
const richTextBlock: RichTextBlock = {
  id: 'block-rich-text-1',
  kind: 'rich_text',
  snapshot_id: SNAPSHOT_ID,
  data_ref: { kind: 'rich_text', id: 'block-rich-text-1' },
  source_refs: [],
  as_of: '2026-06-02T00:00:00.000Z',
  segments: [{ type: 'text', text: 'Some analysis text.' }],
}

// A minimal table block (data artifact — should get max-w-[960px])
const tableBlock: TableBlock = {
  id: 'block-table-1',
  kind: 'table',
  snapshot_id: SNAPSHOT_ID,
  data_ref: { kind: 'table', id: 'block-table-1' },
  source_refs: [],
  as_of: '2026-06-02T00:00:00.000Z',
  columns: ['Metric', 'Value'],
  rows: [['Revenue', 100]],
}

const assistantMessage: ChatMessage = {
  message_id: 'msg-1',
  thread_id: 'thread-1',
  role: 'assistant',
  snapshot_id: SNAPSHOT_ID,
  blocks: [richTextBlock, tableBlock],
  content_hash: 'abc123',
  created_at: '2026-06-02T00:00:00.000Z',
}

function installDomGlobals(domWindow: Window): () => void {
  const globals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
    document?: Document
    window?: Window
    ResizeObserver?: unknown
  }
  const hadActEnv = Object.prototype.hasOwnProperty.call(globals, 'IS_REACT_ACT_ENVIRONMENT')
  const hadDocument = Object.prototype.hasOwnProperty.call(globals, 'document')
  const hadWindow = Object.prototype.hasOwnProperty.call(globals, 'window')
  const hadResizeObserver = Object.prototype.hasOwnProperty.call(globals, 'ResizeObserver')
  const previousActEnv = globals.IS_REACT_ACT_ENVIRONMENT
  const previousDocument = globals.document
  const previousWindow = globals.window
  const previousResizeObserver = globals.ResizeObserver

  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.document = domWindow.document
  globals.window = domWindow
  // JSDOM lacks ResizeObserver — stub it so MessageItem's useLayoutEffect doesn't throw.
  globals.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  return () => {
    if (hadActEnv) globals.IS_REACT_ACT_ENVIRONMENT = previousActEnv
    else delete globals.IS_REACT_ACT_ENVIRONMENT
    if (hadDocument) globals.document = previousDocument
    else delete globals.document
    if (hadWindow) globals.window = previousWindow
    else delete globals.window
    if (hadResizeObserver) globals.ResizeObserver = previousResizeObserver
    else delete globals.ResizeObserver
  }
}

test('MessageItem assistant: prose block gets max-w-[820px], wide block gets max-w-[960px]', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(
        <AuthContext.Provider
          value={{
            session: { userId: USER_ID, displayName: 'Mock User' },
            signIn: () => undefined,
            signOut: () => undefined,
          }}
        >
          <EvidenceInspectorProvider>
            <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
              <MessageItem
                message={assistantMessage}
                onMeasure={() => undefined}
              />
            </BlockRegistryProvider>
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      )
    })

    const html = dom.window.document.body.innerHTML
    assert.ok(
      html.includes('max-w-[820px]'),
      `Expected max-w-[820px] for prose block, got: ${html.slice(0, 400)}`,
    )
    assert.ok(
      html.includes('max-w-[960px]'),
      `Expected max-w-[960px] for wide block, got: ${html.slice(0, 400)}`,
    )
    assert.equal(dom.window.document.querySelector('[data-message-id="msg-1"]')?.getAttribute('id'), null, 'a message carries no anchor id')

    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test('a saved answer copies as text, and a question has no copy button', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const copied: string[] = []
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: async (text: string) => void copied.push(text) },
    configurable: true,
  })
  const userMessage: ChatMessage = { ...assistantMessage, message_id: 'msg-0', role: 'user', blocks: [richTextBlock] }
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(
        <AuthContext.Provider value={{ session: { userId: USER_ID, displayName: 'Mock User' }, signIn: () => undefined, signOut: () => undefined }}>
          <EvidenceInspectorProvider>
            <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
              <MessageItem message={userMessage} onMeasure={() => undefined} />
              <MessageItem message={assistantMessage} onMeasure={() => undefined} />
            </BlockRegistryProvider>
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      )
    })
    const copyButtons = dom.window.document.querySelectorAll('button[aria-label="Copy this answer as text"]')
    assert.equal(copyButtons.length, 1, 'only the answer can be copied')
    assert.ok(dom.window.document.querySelector('[data-role="assistant"]')?.contains(copyButtons[0]!))

    await act(async () => (copyButtons[0] as HTMLButtonElement).click())

    assert.deepEqual(copied, [`Some analysis text.\n\n| Metric | Value |\n| --- | --- |\n| Revenue | 100 |\n\nAs of 2026-06-02T00:00:00.000Z · Snapshot ${SNAPSHOT_ID}`])
    assert.equal(copyButtons[0]!.getAttribute('title'), 'Copied')
    assert.equal(copyButtons[0]!.textContent, '', 'the answer gains no words')
    await act(async () => root.unmount())
  } finally {
    delete (globalThis.navigator as { clipboard?: unknown }).clipboard
    restoreGlobals()
  }
})

test('each saved message shows when it was saved: the question under its bubble, the answer beside its copy button', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const previousTz = process.env.TZ
  process.env.TZ = 'UTC'
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-02T18:00:00.000Z') })
  const question: ChatMessage = { ...assistantMessage, message_id: 'msg-0', role: 'user', blocks: [richTextBlock], created_at: '2026-06-02T14:32:00.000Z' }
  const answer: ChatMessage = { ...assistantMessage, created_at: '2026-05-30T09:05:00.000Z' }
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(
        <AuthContext.Provider value={{ session: { userId: USER_ID, displayName: 'Mock User' }, signIn: () => undefined, signOut: () => undefined }}>
          <EvidenceInspectorProvider>
            <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
              <MessageItem message={question} onMeasure={() => undefined} />
              <MessageItem message={answer} onMeasure={() => undefined} />
            </BlockRegistryProvider>
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      )
    })
    const time = (role: string) => dom.window.document.querySelector(`[data-role="${role}"] time`)!
    assert.deepEqual(
      [time('user').textContent, time('user').getAttribute('title'), time('user').getAttribute('datetime')],
      ['14:32', 'Tuesday, June 2, 2026 at 2:32 PM', '2026-06-02T14:32:00.000Z'],
    )
    assert.equal(time('user').previousElementSibling?.querySelector('p')?.textContent, 'Some analysis text.', 'under the bubble')
    assert.deepEqual([time('assistant').textContent, time('assistant').getAttribute('title')], ['May 30, 09:05', 'Saturday, May 30, 2026 at 9:05 AM'])
    assert.ok(time('assistant').parentElement?.querySelector('button[aria-label="Copy this answer as text"]'), 'beside the copy button')
    await act(async () => root.unmount())
  } finally {
    if (previousTz === undefined) delete process.env.TZ
    else process.env.TZ = previousTz
    restoreGlobals()
  }
})

// The list windows on these heights in the same commit that mounts a message, so a
// height that waits for a ResizeObserver callback is an estimate the list acts on.
test('a message reports its height when it mounts, before any resize callback', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ height: 321 }) as DOMRect
  const measured: Array<[string, number]> = []
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(
        <AuthContext.Provider value={{ session: { userId: USER_ID, displayName: 'Mock User' }, signIn: () => undefined, signOut: () => undefined }}>
          <EvidenceInspectorProvider>
            <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
              <MessageItem message={assistantMessage} onMeasure={(id, height) => measured.push([id, height])} />
            </BlockRegistryProvider>
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      )
    })
    assert.deepEqual(measured, [['msg-1', 321]])
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test('a saved answer keeps a collapsed "Worked for" line that opens to its timed steps; an answer saved without one shows none', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const worked: ChatMessage = {
    ...assistantMessage,
    message_id: 'msg-worked',
    work_summary: {
      elapsed_ms: 34_200,
      events: [
        { type: 'turn.started', at_ms: 0, bundle_id: 'single_subject_analysis' },
        { type: 'tool.started', at_ms: 2_500, tool_call_id: 'tool-1', tool_name: 'get_quote' },
        { type: 'tool.completed', at_ms: 4_100, tool_call_id: 'tool-1', tool_name: 'get_quote', status: 'ok' },
        { type: 'snapshot.staged', at_ms: 4_100, snapshot_id: SNAPSHOT_ID, status: 'staged' },
        { type: 'snapshot.sealed', at_ms: 4_600, snapshot_id: SNAPSHOT_ID, status: 'sealed' },
        { type: 'block.began', at_ms: 4_600, block_id: 'block-rich-text-1', kind: 'rich_text' },
        { type: 'block.completed', at_ms: 9_000, block_id: 'block-rich-text-1' },
      ],
    },
  }
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(
        <AuthContext.Provider value={{ session: { userId: USER_ID, displayName: 'Mock User' }, signIn: () => undefined, signOut: () => undefined }}>
          <EvidenceInspectorProvider>
            <BlockRegistryProvider registry={createDefaultBlockRegistry()}>
              <MessageItem message={worked} onMeasure={() => undefined} />
              <MessageItem message={assistantMessage} onMeasure={() => undefined} />
            </BlockRegistryProvider>
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      )
    })
    const doc = dom.window.document
    const line = doc.querySelector<HTMLButtonElement>('[data-message-id="msg-worked"] button[aria-expanded]')!
    const list = () => doc.getElementById(line.getAttribute('aria-controls')!)!
    const steps = () => [...list().querySelectorAll('li')].map((li) => li.textContent)

    assert.equal(line.textContent, 'Worked for 34s · 4 steps')
    assert.equal(line.getAttribute('aria-expanded'), 'false')
    assert.equal(list().hidden, true)

    await act(async () => line.click())
    assert.equal(line.getAttribute('aria-expanded'), 'true')
    assert.equal(list().hidden, false)
    assert.deepEqual(steps(), ['Planner4s', 'Composer4s', 'Fundamentals1s', 'Snapshot0s'])

    assert.equal(doc.querySelector('[data-message-id="msg-1"] button[aria-expanded]'), null)
    assert.ok(!doc.querySelector('[data-message-id="msg-1"]')!.textContent!.includes('Worked for'))

    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})
