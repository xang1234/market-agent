import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

import { issuerIdFromSubject } from '../symbol/profile.ts'
import type { ResolvedSubject } from '../symbol/search.ts'
import { AuthInterruptContext } from './authInterruptTypes.ts'
import { AuthContext } from './authTypes.ts'
import { RightRailProvider } from './RightRailProvider.tsx'
import { RightRailSlot } from './RightRailSlot.tsx'
import { SubjectDetailShell } from './SubjectDetailShell.tsx'
import { useSubjectDetailContext } from './subjectDetailOutletContext.ts'

const LISTING_ID = '11111111-1111-4111-a111-111111111111'
const ALT_LISTING_ID = '44444444-4444-4444-a444-444444444444'
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

const AMBIGUOUS_LISTING: ResolvedSubject = {
  subject_ref: { kind: 'listing', id: ALT_LISTING_ID },
  display_name: 'APC · XFRA — Apple Inc.',
  confidence: 0.72,
  identity_level: 'listing',
  display_label: 'APC · XFRA — Apple Inc.',
  display_labels: {
    primary: 'APC · XFRA — Apple Inc.',
    legal_name: 'Apple Inc.',
    ticker: 'APC',
    mic: 'XFRA',
  },
}

function SubjectIssuerProbe() {
  const { subject } = useSubjectDetailContext()
  return <div data-testid="issuer-id">{issuerIdFromSubject(subject) ?? 'missing'}</div>
}

function SubjectIssuerAndPathProbe() {
  const { subject } = useSubjectDetailContext()
  const location = useLocation()
  return (
    <div>
      <span data-testid="issuer-id">{issuerIdFromSubject(subject) ?? 'missing'}</span>
      <span data-testid="pathname">{location.pathname}</span>
    </div>
  )
}

function ChildMountedProbe() {
  return <div data-testid="child-mounted">child-mounted</div>
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
        <RightRailProvider>
          {element}
          <RightRailSlot />
        </RightRailProvider>
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

test('SubjectDetailShell surfaces issuer news & filings in the persistent right rail', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const calls: string[] = []

  try {
    globalThis.fetch = async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.startsWith('/v1/evidence/issuer-news?')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                document_id: 'doc-1',
                kind: 'filing',
                title: 'Q1 FY26 10-Q filed',
                published_at: '2026-06-01T00:00:00.000Z',
                provider: 'sec_edgar',
                provider_doc_id: '0000-1',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
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
          <MemoryRouter
            initialEntries={[
              {
                pathname: `/symbol/listing%3A${LISTING_ID}/overview`,
                state: { subject: HYDRATED_LISTING },
              },
            ]}
          >
            <Routes>
              <Route path="/symbol/:subjectRef" element={<SubjectDetailShell />}>
                <Route path="overview" element={<ChildMountedProbe />} />
              </Route>
            </Routes>
          </MemoryRouter>,
        ),
      )
    })

    for (
      let attempt = 0;
      attempt < 5 && !dom.window.document.body.innerHTML.includes('News &amp; filings');
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }

    assert.match(dom.window.document.body.innerHTML, /News &amp; filings/)
    assert.match(dom.window.document.body.innerHTML, /Q1 FY26 10-Q filed/)
    assert.match(dom.window.document.body.innerHTML, /sec_edgar/)
    assert.ok(
      calls.some((url) => url.startsWith(`/v1/evidence/issuer-news?issuer_id=${ISSUER_ID}`)),
    )
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restoreGlobals()
  }
})

for (const tab of ['earnings', 'holders', 'signals'] as const) {
  test(`SubjectDetailShell resolves legacy ticker routes and preserves the ${tab} tab`, async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
    const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
    const originalFetch = globalThis.fetch
    const resolveBodies: unknown[] = []

    try {
      globalThis.fetch = async (input, init) => {
        const url = String(input)
        if (url === '/v1/subjects/resolve') {
          resolveBodies.push(JSON.parse(String(init?.body)))
          return new Response(JSON.stringify({ subjects: [HYDRATED_LISTING], unresolved: [] }), {
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
            <MemoryRouter initialEntries={[`/symbol/AAPL/${tab}`]}>
              <Routes>
                <Route path="/symbol/:subjectRef" element={<SubjectDetailShell />}>
                  <Route path={tab} element={<SubjectIssuerAndPathProbe />} />
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
      assert.match(
        dom.window.document.body.innerHTML,
        new RegExp(`/symbol/listing%3A${LISTING_ID}/${tab}`),
      )
      assert.deepEqual(resolveBodies, [{ text: 'AAPL' }])
      await act(async () => root.unmount())
    } finally {
      globalThis.fetch = originalFetch
      restoreGlobals()
    }
  })
}

test('SubjectDetailShell blocks issuer-scoped child sections when canonical hydration fails', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const originalWarn = console.warn

  try {
    console.warn = () => undefined
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url === '/v1/subjects/hydrate') {
        return new Response(JSON.stringify({ error: 'missing subject' }), {
          status: 404,
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
          <MemoryRouter initialEntries={[`/symbol/listing%3A${LISTING_ID}/earnings`]}>
            <Routes>
              <Route path="/symbol/:subjectRef" element={<SubjectDetailShell />}>
                <Route path="earnings" element={<ChildMountedProbe />} />
              </Route>
            </Routes>
          </MemoryRouter>,
        ),
      )
    })

    for (
      let attempt = 0;
      attempt < 5 && !dom.window.document.body.innerHTML.includes('Subject context unavailable');
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }

    assert.match(dom.window.document.body.innerHTML, /Subject context unavailable/)
    assert.doesNotMatch(dom.window.document.body.innerHTML, /child-mounted/)
    await act(async () => root.unmount())
  } finally {
    console.warn = originalWarn
    globalThis.fetch = originalFetch
    restoreGlobals()
  }
})

test('SubjectDetailShell renders an explicit choice state for ambiguous legacy ticker routes', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch

  try {
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url === '/v1/subjects/resolve') {
        return new Response(
          JSON.stringify({ subjects: [HYDRATED_LISTING, AMBIGUOUS_LISTING], unresolved: [] }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
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
          <MemoryRouter initialEntries={['/symbol/AAPL/signals']}>
            <Routes>
              <Route path="/symbol/:subjectRef" element={<SubjectDetailShell />}>
                <Route path="signals" element={<ChildMountedProbe />} />
              </Route>
            </Routes>
          </MemoryRouter>,
        ),
      )
    })

    for (
      let attempt = 0;
      attempt < 5 && !dom.window.document.body.innerHTML.includes('Choose a listing to continue');
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }

    assert.match(dom.window.document.body.innerHTML, /Choose a listing to continue/)
    assert.match(dom.window.document.body.innerHTML, /AAPL/)
    assert.match(dom.window.document.body.innerHTML, /APC/)
    assert.doesNotMatch(dom.window.document.body.innerHTML, /child-mounted/)
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restoreGlobals()
  }
})
