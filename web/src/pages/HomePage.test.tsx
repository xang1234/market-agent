import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToString } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { UserHomeContent, UserHomeView } from './HomePage.tsx'
import type { HomeSummary } from '../home/summaryClient.ts'

const USER_ID_A = '00000000-0000-4000-8000-000000000001'
const USER_ID_B = '00000000-0000-4000-8000-00000000000b'

const EMPTY_SUMMARY: HomeSummary = {
  generated_at: '2026-05-05T12:00:00.000Z',
  findings: { cards: [] },
  market_pulse: { rows: [], omitted: [] },
  watchlist_movers: { reason: 'no_default_watchlist', rows: [], omitted: [] },
  agent_summaries: { window_hours: 24, rows: [] },
  saved_screens: { rows: [] },
}

function fakeFetchOk(body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
}

function fakeFetchFail(status: number): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ error: 'boom' }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
}

function fakeFetchHanging(): { fetch: typeof fetch; resolve: (response: Response) => void } {
  let resolve!: (response: Response) => void
  const pending = new Promise<Response>((r) => (resolve = r))
  return { fetch: async () => pending, resolve }
}

test('UserHomeView renders the loading hint when state.kind is loading', () => {
  const html = renderToString(<UserHomeView state={{ kind: 'loading' }} />)
  assert.match(html, /Loading Home/)
})

test('UserHomeView renders the error message when state.kind is error', () => {
  const html = renderToString(<UserHomeView state={{ kind: 'error', message: 'boom' }} />)
  assert.match(html, /Home is unavailable/)
  assert.match(html, /boom/)
})

test('UserHomeView renders all five sections when state.kind is ready', () => {
  const html = renderToString(<UserHomeView state={{ kind: 'ready', summary: EMPTY_SUMMARY }} />)
  assert.match(html, /Findings/)
  assert.match(html, /Market pulse/)
  assert.match(html, /Watchlist movers/)
  assert.match(html, /Agent summaries/)
  assert.match(html, /Pinned screens/)
})

test('UserHomeContent fetches the summary on mount and renders ready state', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const document = dom.window.document
  const container = document.getElementById('root')!
  // React 19's IS_REACT_ACT_ENVIRONMENT must be set so act() flushes useEffect
  // synchronously the way it does in DOM-backed test renderers.
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as unknown as { document: Document }).document = document
  ;(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window
  try {
    const root = createRoot(container)
    await act(async () => {
      root.render(<UserHomeContent userId={USER_ID_A} fetchImpl={fakeFetchOk(EMPTY_SUMMARY)} />)
    })
    const html = container.innerHTML
    assert.match(html, /Findings/)
    assert.match(html, /Watchlist movers/)
    await act(async () => root.unmount())
  } finally {
    delete (globalThis as unknown as { document?: Document }).document
    delete (globalThis as unknown as { window?: Window }).window
  }
})

test('UserHomeContent renders the error state when fetch returns non-200', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const document = dom.window.document
  const container = document.getElementById('root')!
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as unknown as { document: Document }).document = document
  ;(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window
  try {
    const root = createRoot(container)
    await act(async () => {
      root.render(<UserHomeContent userId={USER_ID_A} fetchImpl={fakeFetchFail(500)} />)
    })
    const html = container.innerHTML
    assert.match(html, /Home is unavailable/)
    assert.match(html, /HTTP 500/)
    await act(async () => root.unmount())
  } finally {
    delete (globalThis as unknown as { document?: Document }).document
    delete (globalThis as unknown as { window?: Window }).window
  }
})

test('UserHomeContent ignores a stale fetch resolution that lands after an abort', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const document = dom.window.document
  const container = document.getElementById('root')!
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as unknown as { document: Document }).document = document
  ;(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window
  try {
    const hanging = fakeFetchHanging()
    const root = createRoot(container)

    // Mount with userId A; the fetch hangs, leaving the component in `loading`.
    await act(async () => {
      root.render(<UserHomeContent userId={USER_ID_A} fetchImpl={hanging.fetch} />)
    })
    assert.match(container.innerHTML, /Loading Home/)

    // Switch to userId B; the previous A-fetch is now aborted.
    await act(async () => {
      root.render(<UserHomeContent userId={USER_ID_B} fetchImpl={fakeFetchOk(EMPTY_SUMMARY)} />)
    })
    assert.match(container.innerHTML, /Findings/)

    // Late-resolving A-fetch must NOT overwrite B's ready state.
    await act(async () => {
      hanging.resolve(
        new Response(JSON.stringify(EMPTY_SUMMARY), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
    assert.match(container.innerHTML, /Findings/)
    assert.doesNotMatch(container.innerHTML, /Loading Home/)

    await act(async () => root.unmount())
  } finally {
    delete (globalThis as unknown as { document?: Document }).document
    delete (globalThis as unknown as { window?: Window }).window
  }
})
