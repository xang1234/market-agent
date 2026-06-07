import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'

import type { SubjectDetailOutletContext } from '../../shell/subjectDetailOutletContext.ts'
import type { ResolvedSubject } from '../../symbol/search.ts'
import type { GetSeriesResponse, NormalizedSeriesQuery } from '../../symbol/series.ts'
import { OverviewSection } from './OverviewSection.tsx'

const LISTING_ID = '11111111-1111-4111-a111-111111111111'
const SOURCE_ID = '00000000-0000-4000-a000-000000000001'
const DAY_MS = 24 * 60 * 60 * 1000

const LISTING_SUBJECT: ResolvedSubject = {
  subject_ref: { kind: 'listing', id: LISTING_ID },
  display_name: 'Apple Inc.',
  confidence: 1,
}

function SubjectOutlet({ subject }: { subject: ResolvedSubject }): ReactElement {
  return <Outlet context={{ subject } satisfies SubjectDetailOutletContext} />
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

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      assertion()
      return
    } catch (err) {
      lastError = err
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }
  throw lastError
}

function seriesResponse(query: NormalizedSeriesQuery): GetSeriesResponse {
  return {
    query,
    results: [
      {
        listing: { kind: 'listing', id: LISTING_ID },
        outcome: {
          outcome: 'available',
          data: {
            listing: { kind: 'listing', id: LISTING_ID },
            interval: '1d',
            range: query.range,
            bars: [
              { ts: '2026-04-24T00:00:00.000Z', open: 1, high: 2, low: 1, close: 1.5, volume: 10 },
              { ts: '2026-04-25T00:00:00.000Z', open: 1.5, high: 3, low: 1.5, close: 2, volume: 12 },
            ],
            as_of: '2026-04-26T15:30:00.000Z',
            delay_class: 'delayed_15m',
            currency: 'USD',
            source_id: SOURCE_ID,
            adjustment_basis: 'split_and_div_adjusted',
          },
        },
      },
    ],
  }
}

function spanDays(query: NormalizedSeriesQuery): number {
  return Math.round((Date.parse(query.range.end) - Date.parse(query.range.start)) / DAY_MS)
}

test('Overview price card toggles the series window from 1M to 6M', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const seriesQueries: NormalizedSeriesQuery[] = []
  let root: Root | null = null

  try {
    globalThis.fetch = async (input, init) => {
      const url = input.toString()
      if (url === '/v1/market/series') {
        const query = JSON.parse(String(init?.body ?? '{}')) as NormalizedSeriesQuery
        seriesQueries.push(query)
        return new Response(JSON.stringify(seriesResponse(query)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      // profile / stats / consensus have no issuer context for a listing
      // subject; let them fall through to unavailable.
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    }

    const mountedRoot = createRoot(dom.window.document.getElementById('root')!)
    root = mountedRoot
    await act(async () => {
      mountedRoot.render(
        <MemoryRouter initialEntries={['/symbol/listing/overview']}>
          <Routes>
            <Route element={<SubjectOutlet subject={LISTING_SUBJECT} />}>
              <Route path="/symbol/listing/overview" element={<OverviewSection />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      )
    })

    // Default window is 1M (≈30d), preserving the prior fixed view.
    await waitFor(() => {
      assert.equal(seriesQueries.length, 1)
    })
    assert.equal(spanDays(seriesQueries[0]), 30)

    const sixMonth = dom.window.document.querySelector('[data-testid="price-window-6M"]')
    assert.ok(sixMonth, 'expected a 6M toggle option')
    await act(async () => {
      sixMonth.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })

    // Toggling re-keys useFetched once and re-requests the wider window.
    await waitFor(() => {
      assert.ok(
        seriesQueries.some((q) => spanDays(q) === 180),
        'expected a 6M (≈180d) series request after toggling',
      )
    })
  } finally {
    if (root !== null) {
      await act(async () => root?.unmount())
    }
    dom.window.close()
    globalThis.fetch = originalFetch
    restoreGlobals()
  }
})
