import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToString } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

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

function fakeFetchHanging(): { fetch: typeof fetch; resolve: (response: Response) => void; readonly signal?: AbortSignal } {
  let resolvePending: ((response: Response) => void) | undefined
  let seenSignal: AbortSignal | undefined
  const fetchImpl: typeof fetch = async (_input, init) => {
    seenSignal = init?.signal ?? undefined
    if (seenSignal?.aborted) throw abortError()
    return new Promise<Response>((resolveResponse, rejectResponse) => {
      let settled = false
      const onAbort = () => {
        if (settled) return
        settled = true
        rejectResponse(abortError())
      }
      seenSignal?.addEventListener('abort', onAbort, { once: true })
      resolvePending = (response) => {
        if (settled) return
        settled = true
        seenSignal?.removeEventListener('abort', onAbort)
        resolveResponse(response)
      }
    })
  }
  return {
    fetch: fetchImpl,
    resolve: (response) => {
      if (!resolvePending) throw new Error('hanging fetch has not started')
      resolvePending(response)
    },
    get signal() {
      return seenSignal
    },
  }
}

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

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

test('UserHomeView renders the loading hint when state.kind is loading', () => {
  const html = renderToString(<MemoryRouter><UserHomeView state={{ kind: 'loading' }} /></MemoryRouter>)
  assert.match(html, /<span role="status"[^>]*><span class="sr-only">Loading Home<\/span><\/span>/)
})

test('UserHomeView says Home could not load and keeps the reason behind Details', () => {
  const doc = new JSDOM(renderToString(<MemoryRouter><UserHomeView state={{ kind: 'error', message: 'boom', retry: () => {} }} /></MemoryRouter>)).window.document
  assert.equal(doc.body.textContent, "Couldn't load Home.RetryDetailsboom")
})

test('UserHomeView renders all five sections when state.kind is ready', () => {
  const html = renderToString(<MemoryRouter><UserHomeView state={{ kind: 'ready', summary: EMPTY_SUMMARY }} /></MemoryRouter>)
  assert.match(html, /Findings/)
  assert.match(html, /Market pulse/)
  assert.match(html, /Watchlist movers/)
  assert.match(html, /Agent summaries/)
  assert.match(html, /Pinned screens/)
})

test('UserHomeView applies tabular numerals to quote and count metrics', () => {
  const summary: HomeSummary = {
    ...EMPTY_SUMMARY,
    findings: {
      cards: [{
        home_card_id: 'card-1',
        headline: 'Revenue acceleration',
        severity: 'high',
        support_count: 12,
        contributing_finding_count: 3,
        created_at: '2026-05-05T12:00:00.000Z',
        destination: { kind: 'none', reason: 'fixture' },
        subject_refs: [],
      }],
    },
    market_pulse: {
      rows: [{
        listing: { kind: 'listing', id: '22222222-2222-4222-8222-222222222222' },
        ticker: 'AAPL',
        mic: 'XNAS',
        price: 191.42,
        prev_close: 189.07,
        change_abs: 2.35,
        currency: 'USD',
        change_pct: 0.0124,
        session_state: 'regular',
        delay_class: 'delayed_15m',
        as_of: '2026-05-05T12:00:00.000Z',
      }],
      omitted: [],
    },
    agent_summaries: {
      window_hours: 24,
      rows: [{
        agent_id: 'agent-1',
        name: 'Earnings monitor',
        enabled: true,
        last_run: null,
        finding_counts: { total: 7, high_or_critical: 2, critical: 1 },
        latest_high_or_critical_finding: null,
      }],
    },
  }

  const html = renderToString(<MemoryRouter><UserHomeView state={{ kind: 'ready', summary }} /></MemoryRouter>)

  assert.match(html, /class="[^"]*\bnum\b[^"]*"[^>]*>\+1\.24%/)
  assert.match(html, /class="[^"]*\bnum\b[^"]*"[^>]*>\$191\.42/)
  assert.match(html, /class="num">12<\/span> sources/)
  assert.match(html, /class="num">7<\/span> total/)
})

test('UserHomeContent fetches the summary on mount and renders ready state', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const document = dom.window.document
  const container = document.getElementById('root')!
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  try {
    const root = createRoot(container)
    await act(async () => {
      root.render(<MemoryRouter><UserHomeContent userId={USER_ID_A} fetchImpl={fakeFetchOk(EMPTY_SUMMARY)} /></MemoryRouter>)
    })
    const html = container.innerHTML
    assert.match(html, /Findings/)
    assert.match(html, /Watchlist movers/)
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test('UserHomeContent renders the error state when fetch returns non-200', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const document = dom.window.document
  const container = document.getElementById('root')!
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  try {
    const root = createRoot(container)
    await act(async () => {
      root.render(<MemoryRouter><UserHomeContent userId={USER_ID_A} fetchImpl={fakeFetchFail(500)} /></MemoryRouter>)
    })
    assert.equal(container.textContent, "Couldn't load Home.RetryDetailsfetch home summary failed with HTTP 500")
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test('UserHomeContent Retry shows loading and then the summary', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const container = dom.window.document.getElementById('root')!
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  let calls = 0
  const fail = fakeFetchFail(503)
  const ok = fakeFetchOk(EMPTY_SUMMARY)
  const second = fakeFetchHanging()
  const fetchImpl: typeof fetch = (input, init) => [fail, second.fetch, ok][calls++](input, init)
  try {
    const root = createRoot(container)
    await act(async () => {
      root.render(<MemoryRouter><UserHomeContent userId={USER_ID_A} fetchImpl={fetchImpl} /></MemoryRouter>)
    })
    assert.equal(container.textContent, "Couldn't load Home.RetryDetailsfetch home summary failed with HTTP 503")

    await act(async () => container.querySelector('button')!.click())
    assert.equal(container.textContent, 'Loading Home')

    await act(async () => second.resolve(new Response(JSON.stringify(EMPTY_SUMMARY), { status: 200 })))
    assert.match(container.textContent ?? '', /^Findings/)
    assert.equal(calls, 2)
    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})

test('UserHomeContent ignores a stale fetch resolution that lands after an abort', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const document = dom.window.document
  const container = document.getElementById('root')!
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  try {
    const hanging = fakeFetchHanging()
    const root = createRoot(container)

    // Mount with userId A; the fetch hangs, leaving the component in `loading`.
    await act(async () => {
      root.render(<MemoryRouter><UserHomeContent userId={USER_ID_A} fetchImpl={hanging.fetch} /></MemoryRouter>)
    })
    assert.match(container.textContent ?? '', /Loading Home/)

    // Switch to userId B; the previous A-fetch is now aborted.
    await act(async () => {
      root.render(<MemoryRouter><UserHomeContent userId={USER_ID_B} fetchImpl={fakeFetchOk(EMPTY_SUMMARY)} /></MemoryRouter>)
    })
    assert.equal(hanging.signal?.aborted, true)
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
    assert.doesNotMatch(container.textContent ?? '', /Loading Home/)

    await act(async () => root.unmount())
  } finally {
    restoreGlobals()
  }
})
