import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { Markdown } from './Markdown.tsx'

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

async function renderHtml(jsx: React.ReactElement): Promise<string> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(jsx)
    })
    const html = dom.window.document.getElementById('root')!.innerHTML
    await act(async () => root.unmount())
    return html
  } finally {
    restoreGlobals()
  }
}

const GFM_TABLE = `| Metric | FY25 |
| --- | --- |
| Revenue | $12.59B |
| Net Income | $2.1B |`

const HEADING_BOLD = `# GLW\n\n**$176.70**`

test('Markdown renders GFM table with <table>, <th>, and <td>', async () => {
  const html = await renderHtml(<Markdown text={GFM_TABLE} />)
  assert.match(html, /<table[\s>]/)
  assert.match(html, /<th[^>]*>Metric<\/th>/)
  assert.match(html, /<td[^>]*>\$12\.59B<\/td>/)
})

test('Markdown renders heading and bold text', async () => {
  const html = await renderHtml(<Markdown text={HEADING_BOLD} />)
  assert.match(html, /<h1[^>]*>GLW<\/h1>/)
  assert.match(html, /<strong[^>]*>\$176\.70<\/strong>/)
})
