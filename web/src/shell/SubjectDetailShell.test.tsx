import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { issuerIdFromSubject } from '../symbol/profile.ts'
import type { ResolvedSubject } from '../symbol/search.ts'
import { AuthInterruptContext } from './authInterruptTypes.ts'
import { AuthContext } from './authTypes.ts'
import { SubjectDetailShell } from './SubjectDetailShell.tsx'
import { useSubjectDetailContext } from './subjectDetailOutletContext.ts'

const LISTING_ID = '11111111-1111-4111-a111-111111111111'
const ISSUER_ID = '33333333-3333-4333-a333-333333333333'

const HYDRATED_LISTING: ResolvedSubject = {
  subject_ref: { kind: 'listing', id: LISTING_ID },
  display_name: 'AAPL · XNAS — Apple Inc.',
  confidence: 1,
  identity_level: 'listing',
  display_label: 'AAPL · XNAS — Apple Inc.',
  display_labels: {
    primary: 'AAPL · XNAS — Apple Inc.',
    legal_name: 'Apple Inc.',
    ticker: 'AAPL',
    mic: 'XNAS',
  },
  normalized_input: `listing:${LISTING_ID}`,
  resolution_path: 'direct_ref',
  context: {
    issuer: {
      subject_ref: { kind: 'issuer', id: ISSUER_ID },
      legal_name: 'Apple Inc.',
      cik: '320193',
      sector: 'Technology',
      industry: 'Consumer Electronics',
    },
    instrument: {
      subject_ref: { kind: 'instrument', id: '22222222-2222-4222-a222-222222222222' },
      issuer_ref: { kind: 'issuer', id: ISSUER_ID },
      asset_type: 'common_stock',
    },
    listing: {
      subject_ref: { kind: 'listing', id: LISTING_ID },
      instrument_ref: { kind: 'instrument', id: '22222222-2222-4222-a222-222222222222' },
      issuer_ref: { kind: 'issuer', id: ISSUER_ID },
      mic: 'XNAS',
      ticker: 'AAPL',
      trading_currency: 'USD',
      timezone: 'America/New_York',
    },
  },
}

function SubjectIssuerProbe() {
  const { subject } = useSubjectDetailContext()
  return <div data-testid="issuer-id">{issuerIdFromSubject(subject) ?? 'missing'}</div>
}

function wrapShell(element: React.ReactElement): React.ReactElement {
  return (
    <AuthContext.Provider
      value={{
        session: null,
        signIn: () => undefined,
        signOut: () => undefined,
      }}
    >
      <AuthInterruptContext.Provider
        value={{
          pending: null,
          cancel: () => undefined,
          requestProtectedAction: () => undefined,
        }}
      >
        {element}
      </AuthInterruptContext.Provider>
    </AuthContext.Provider>
  )
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

test('SubjectDetailShell hydrates a bare listing route before child sections need issuer context', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const calls: string[] = []

  try {
    globalThis.fetch = async (input) => {
      const url = String(input)
      calls.push(url)
      if (url === '/v1/subjects/hydrate') {
        return new Response(JSON.stringify({ subject: HYDRATED_LISTING }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ unavailable: { detail: 'test quote unavailable' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }

    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(
        wrapShell(
          <MemoryRouter initialEntries={[`/symbol/listing%3A${LISTING_ID}/overview`]}>
            <Routes>
              <Route path="/symbol/:subjectRef" element={<SubjectDetailShell />}>
                <Route path="overview" element={<SubjectIssuerProbe />} />
              </Route>
            </Routes>
          </MemoryRouter>,
        ),
      )
    })

    for (let attempt = 0; attempt < 5 && !dom.window.document.body.innerHTML.includes(ISSUER_ID); attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }

    assert.match(dom.window.document.body.innerHTML, new RegExp(ISSUER_ID))
    assert.ok(calls.includes('/v1/subjects/hydrate'))
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restoreGlobals()
  }
})
