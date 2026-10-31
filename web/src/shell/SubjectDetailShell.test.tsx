import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

import { issuerIdFromSubject } from '../symbol/profile.ts'
import { QuoteRow } from '../symbol/QuoteRow.tsx'
import type { ResolvedSubject } from '../symbol/search.ts'
import { AuthInterruptContext } from './authInterruptTypes.ts'
import { AuthContext } from './authTypes.ts'
import { RightRailProvider } from './RightRailProvider.tsx'
import { RightRailSlot } from './RightRailSlot.tsx'
import { SubjectDetailShell } from './SubjectDetailShell.tsx'
import { useSubjectDetailContext } from './subjectDetailOutletContext.ts'
import { resetResourcesForTests } from '../fetch/resource.ts'

afterEach(resetResourcesForTests)

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

const UNLABELLED_LISTING: ResolvedSubject = {
  subject_ref: { kind: 'listing', id: '99999999-9999-4999-a999-999999999999' },
  confidence: 0.4,
  identity_level: 'listing',
}

const MIC_ONLY_LISTING: ResolvedSubject = {
  subject_ref: { kind: 'listing', id: '88888888-8888-4888-a888-888888888888' },
  confidence: 0.3,
  identity_level: 'listing',
  display_labels: { primary: '', mic: 'XLON' },
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
    const header = dom.window.document.querySelector('[data-testid="subject-header"]')!
    assert.equal(header.querySelector('h1')?.textContent, 'Apple Inc.')
    assert.equal(header.querySelector('section > p')?.textContent, 'Technology · Consumer Electronics')
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

test('a failed hydration says "Couldn\'t load this symbol.", blocks child sections, and Retry hydrates again', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  let hydrations = 0

  try {
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url === '/v1/subjects/hydrate') {
        hydrations += 1
        return hydrations === 1
          ? new Response(JSON.stringify({ error: 'bad gateway' }), { status: 502 })
          : new Response(JSON.stringify({ subject: HYDRATED_LISTING }), { status: 200 })
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
    const settle = async (done: () => boolean) => {
      for (let attempt = 0; attempt < 5 && !done(); attempt += 1) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
      }
    }
    const body = dom.window.document.body
    const canvas = () => body.querySelector('nav[aria-label="Subject sections"]')!.nextElementSibling!

    await settle(() => canvas().querySelector('details') !== null)
    assert.equal(canvas().querySelector('p')?.textContent, "Couldn't load this symbol.")
    assert.equal(canvas().querySelector('details')?.textContent, 'Detailssubject hydrate failed with HTTP 502')
    assert.doesNotMatch(body.innerHTML, /child-mounted/)

    const retry = [...canvas().querySelectorAll('button')].find((button) => button.textContent === 'Retry')!
    await act(async () => retry.click())
    await settle(() => body.innerHTML.includes('child-mounted'))
    assert.equal(hydrations, 2)
    assert.equal(canvas().textContent, 'child-mounted')
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restoreGlobals()
  }
})

test('an issuer route titles the header with a skeleton while hydrating and a neutral "Symbol" once hydration fails', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  let failHydration: () => void = () => undefined

  try {
    globalThis.fetch = async (input) => {
      if (String(input) === '/v1/subjects/hydrate') {
        await new Promise<void>((resolve) => {
          failHydration = resolve
        })
        return new Response(JSON.stringify({ error: 'bad gateway' }), { status: 502 })
      }
      return new Response('{}', { status: 404 })
    }

    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(
        wrapShell(
          <MemoryRouter initialEntries={[`/symbol/issuer%3A${ISSUER_ID}/overview`]}>
            <Routes>
              <Route path="/symbol/:subjectRef" element={<SubjectDetailShell />}>
                <Route path="overview" element={<ChildMountedProbe />} />
              </Route>
            </Routes>
          </MemoryRouter>,
        ),
      )
    })
    const header = dom.window.document.querySelector('[data-testid="subject-header"]')!

    assert.equal(header.querySelector('h1 [role="status"]')?.textContent, 'Loading symbol name')
    assert.doesNotMatch(header.textContent ?? '', /subject/i)

    await act(async () => failHydration())
    for (let attempt = 0; attempt < 5 && header.querySelector('h1 [role="status"]') !== null; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    assert.equal(header.querySelector('h1')?.textContent, 'Symbol')
    assert.equal(header.querySelector('h1 [role="status"]'), null)
    await act(async () => root.unmount())
  } finally {
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
          JSON.stringify({ subjects: [HYDRATED_LISTING, AMBIGUOUS_LISTING, UNLABELLED_LISTING, MIC_ONLY_LISTING], unresolved: [] }),
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
    assert.deepEqual(
      [...dom.window.document.querySelectorAll('li a')].map((link) => [...link.children].map((span) => span.textContent)),
      [['AAPL · XNAS — Apple Inc.'], ['APC · XFRA — Apple Inc.'], ['Symbol 3'], ['XLON']],
    )
    assert.doesNotMatch(dom.window.document.body.innerHTML, /child-mounted/)
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restoreGlobals()
  }
})

test('the subject header and a QuoteRow on the same listing share one quote request', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const originalFetch = globalThis.fetch
  const quoteCalls: string[] = []

  try {
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url === '/v1/subjects/hydrate') {
        return new Response(JSON.stringify({ subject: HYDRATED_LISTING }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.startsWith('/v1/market/quote')) {
        quoteCalls.push(url)
        return new Response(
          JSON.stringify({
            quote: {
              listing: { kind: 'listing', id: LISTING_ID },
              price: 196.58,
              prev_close: 195.34,
              change_abs: 1.24,
              change_pct: 0.006348,
              session_state: 'regular',
              as_of: '2026-04-22T15:30:00.000Z',
              delay_class: 'delayed_15m',
              currency: 'USD',
              source_id: '00000000-0000-4000-a000-000000000001',
            },
            provenance: { provider: 'polygon_market', source_id: '00000000-0000-4000-a000-000000000001' },
            listing_context: { ticker: 'AAPL', mic: 'XNAS', timezone: 'America/New_York' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    }

    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(
        wrapShell(
          <MemoryRouter initialEntries={[`/symbol/listing%3A${LISTING_ID}/overview`]}>
            <ul>
              <QuoteRow subjectRef={{ kind: 'listing', id: LISTING_ID }} />
            </ul>
            <Routes>
              <Route path="/symbol/:subjectRef" element={<SubjectDetailShell />}>
                <Route path="overview" element={<ChildMountedProbe />} />
              </Route>
            </Routes>
          </MemoryRouter>,
        ),
      )
    })

    const prices = () => dom.window.document.body.textContent?.match(/\$196\.58/g)?.length ?? 0
    for (let attempt = 0; attempt < 10 && prices() < 2; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }

    assert.equal(prices(), 2)
    assert.deepEqual(quoteCalls, [`/v1/market/quote?subject_kind=listing&subject_id=${LISTING_ID}`])
    await act(async () => root.unmount())
  } finally {
    globalThis.fetch = originalFetch
    restoreGlobals()
  }
})
