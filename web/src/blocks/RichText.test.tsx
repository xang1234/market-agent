import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { SnapshotManifestContext } from './snapshotManifestContext.ts'
import { RichText } from './RichText.tsx'
import type { RichTextBlock } from './types.ts'

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

const SNAPSHOT_ID = '11111111-1111-4111-8111-111111111111'

const MARKDOWN_TABLE = '| M | FY25 |\n| --- | --- |\n| Rev | $12B |'

const block: RichTextBlock = {
  id: 'rich-text-md-1',
  kind: 'rich_text',
  snapshot_id: SNAPSHOT_ID,
  data_ref: { kind: 'rich_text', id: 'rich-text-md-1' },
  source_refs: [],
  as_of: '2026-06-01T00:00:00.000Z',
  segments: [{ type: 'text', text: MARKDOWN_TABLE }],
}

test('RichText renders markdown table for text segments', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(
        <SnapshotManifestContext.Provider value={null}>
          <RichText block={block} />
        </SnapshotManifestContext.Provider>,
      )
    })

    const html = dom.window.document.getElementById('root')!.innerHTML
    assert.match(html, /<table[\s>]/, 'should contain a <table> element')
    assert.match(html, /<td[^>]*>\$12B<\/td>/, 'should contain <td>$12B</td>')

    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})
