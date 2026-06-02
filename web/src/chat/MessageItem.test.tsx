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

    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})
