import '../pages/installDomBeforeReact.ts'

import assert from 'node:assert/strict'
import test from 'node:test'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

import { resetResourcesForTests } from '../fetch/resource.ts'
import { useWatchlist } from '../watchlists/watchlistContext.ts'
import { WatchlistProvider } from '../watchlists/WatchlistProvider.tsx'
import { AuthContext, DEFAULT_MOCK_SESSION } from './authTypes.ts'
import { computeSparklineGeometry, SPARKLINE_DEFAULTS } from '../symbol/sparklineGeometry.ts'
import { WatchlistSection } from './WatchlistSection.tsx'

const MEMBERS_PATH = '/v1/watchlists/default/members'

test('a failed first watchlist load says so, keeps the reason in details, and Retry reloads it', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const originalFetch = globalThis.fetch
  const gets: string[] = []
  globalThis.fetch = async (input) => {
    const path = String(input)
    gets.push(path)
    if (path === MEMBERS_PATH && gets.length === 1) {
      return new Response(JSON.stringify({ error: 'bad gateway' }), { status: 502 })
    }
    return new Response(JSON.stringify({ members: [] }), { status: 200 })
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const section = () => container.querySelector('section[aria-label="Watchlist"]')!
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

  try {
    await act(async () => {
      root.render(
        <AuthContext.Provider value={{ session: DEFAULT_MOCK_SESSION, signIn: () => undefined, signOut: () => undefined }}>
          <MemoryRouter>
            <WatchlistProvider userId={DEFAULT_MOCK_SESSION.userId}>
              <WatchlistSection />
            </WatchlistProvider>
          </MemoryRouter>
        </AuthContext.Provider>,
      )
    })
    await settle()

    assert.equal(section().querySelector('p')?.textContent, "Couldn't load your watchlist.")
    assert.equal(section().querySelector('details')?.textContent, 'Detailslist watchlist members failed with HTTP 502')
    assert.equal(section().querySelector('details')?.open, false)

    const retry = [...section().querySelectorAll('button')].find((button) => button.textContent === 'Retry')!
    await act(async () => retry.click())
    await settle()

    assert.deepEqual(gets, [MEMBERS_PATH, MEMBERS_PATH])
    assert.equal(section().querySelector('details')?.textContent, undefined)
    assert.match(section().textContent ?? '', /No saved symbols yet\. Add one from the search above\.$/)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    globalThis.fetch = originalFetch
  }
})

const ISSUER_REF = { kind: 'issuer', id: '11111111-1111-4111-a111-111111111111' } as const

async function renderRail(reply: (method: string, path: string, body: string) => Response) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => reply(init?.method ?? 'GET', String(input), String(init?.body ?? ''))
  let watchlist: ReturnType<typeof useWatchlist> | null = null
  function Probe() {
    watchlist = useWatchlist()
    return null
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
  await act(async () => {
    root.render(
      <AuthContext.Provider value={{ session: DEFAULT_MOCK_SESSION, signIn: () => undefined, signOut: () => undefined }}>
        <MemoryRouter>
          <WatchlistProvider userId={DEFAULT_MOCK_SESSION.userId}>
            <WatchlistSection />
            <Probe />
          </WatchlistProvider>
        </MemoryRouter>
      </AuthContext.Provider>,
    )
  })
  await settle()
  const section = () => container.querySelector('section[aria-label="Watchlist"]')!
  return {
    section,
    add: async () => {
      await act(async () => watchlist!.addSubject(ISSUER_REF))
      await settle()
    },
    cleanup: async () => {
      await act(async () => root.unmount())
      container.remove()
      globalThis.fetch = originalFetch
      resetResourcesForTests()
    },
  }
}

test('a failed add on an empty watchlist keeps the empty state and says the update failed', async () => {
  const rail = await renderRail((method) => method === 'GET'
    ? new Response(JSON.stringify({ members: [] }), { status: 200 })
    : new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
  try {
    await rail.add()
    assert.match(
      rail.section().textContent ?? '',
      /No saved symbols yet\. Add one from the search above\.Couldn't update your watchlist\.Detailsadd watchlist member failed with HTTP 500$/,
    )
  } finally {
    await rail.cleanup()
  }
})

test('a failed watchlist load keeps its notice and Retry after a symbol is added', async () => {
  const rail = await renderRail((method, path) => {
    if (path === '/v1/subjects/hydrate') return new Response(JSON.stringify({ subject: { subject_ref: ISSUER_REF, display_name: 'Apple Inc.', confidence: 1 } }), { status: 200 })
    return method === 'GET'
      ? new Response(JSON.stringify({ error: 'bad gateway' }), { status: 502 })
      : new Response(JSON.stringify({ status: 'created', member: { subject_ref: ISSUER_REF, created_at: '2026-10-19T00:00:00.000Z' } }), { status: 201 })
  })
  try {
    await rail.add()
    assert.equal(rail.section().querySelectorAll('ul[aria-label="Watchlist members"] > li').length, 1)
    assert.match(rail.section().textContent ?? '', /Couldn't load your watchlist\.RetryDetailslist watchlist members failed with HTTP 502/)
    const row = rail.section().querySelector('ul[aria-label="Watchlist members"] > li')!
    assert.equal(row.textContent, 'Apple Inc.No quote—×')
    assert.equal(row.querySelector('button')?.getAttribute('aria-label'), 'Remove Apple Inc. from watchlist')
  } finally {
    await rail.cleanup()
  }
})

test('each watchlist row is named by its subject, and so is its Remove button', async () => {
  const LISTING_REF = { kind: 'listing', id: '22222222-2222-4222-a222-222222222222' } as const
  const names: Record<string, unknown> = {
    [LISTING_REF.id]: { subject_ref: LISTING_REF, display_labels: { primary: 'AAPL' }, confidence: 1 },
    [ISSUER_REF.id]: { subject_ref: ISSUER_REF, display_name: 'Apple Inc.', confidence: 1 },
  }
  const rail = await renderRail((_method, path, body) => {
    if (path === MEMBERS_PATH) {
      return new Response(JSON.stringify({ members: [LISTING_REF, ISSUER_REF].map((subject_ref) => ({ subject_ref, created_at: '2026-10-19T00:00:00.000Z' })) }), { status: 200 })
    }
    if (path === '/v1/subjects/hydrate') {
      const { subject_ref } = JSON.parse(body) as { subject_ref: { id: string } }
      return new Response(JSON.stringify({ subject: names[subject_ref.id] }), { status: 200 })
    }
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
  })
  try {
    const rows = [...rail.section().querySelectorAll('ul[aria-label="Watchlist members"] > li')]
    assert.deepEqual(rows.map((row) => row.textContent), ['AAPLQuote unavailable—×', 'Apple Inc.No quote—×'])
    assert.deepEqual(rows.map((row) => row.querySelector('button')?.getAttribute('aria-label')), [
      'Remove AAPL from watchlist',
      'Remove Apple Inc. from watchlist',
    ])
  } finally {
    await rail.cleanup()
  }
})

test('Remove buttons stay distinct for same-ticker listings, quoted or not, and for rows that could not be named', async () => {
  const listing = (n: number) => ({ kind: 'listing', id: `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-a${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}` }) as const
  const refs = [listing(3), listing(5), listing(6), listing(7), listing(8), listing(9)]
  const quotes: Record<string, { mic: string; currency: string }> = {
    [refs[0].id]: { mic: 'XNAS', currency: 'USD' },
    [refs[1].id]: { mic: 'XLON', currency: 'GBP' },
  }
  const unquotedMics: Record<string, string> = { [refs[4].id]: 'XNAS', [refs[5].id]: 'XLON' }
  const rail = await renderRail((_method, path, body) => {
    if (path === MEMBERS_PATH) {
      return new Response(JSON.stringify({ members: refs.map((subject_ref) => ({ subject_ref, created_at: '2026-10-19T00:00:00.000Z' })) }), { status: 200 })
    }
    if (path === '/v1/subjects/hydrate') {
      const { subject_ref } = JSON.parse(body) as { subject_ref: { id: string } }
      const mic = unquotedMics[subject_ref.id]
      if (mic) return new Response(JSON.stringify({ subject: { subject_ref, display_labels: { primary: `AAPL · ${mic} — Apple Inc.`, ticker: 'AAPL', mic }, confidence: 1 } }), { status: 200 })
    }
    const id = new URL(path, 'http://localhost').searchParams.get('subject_id')
    const quote = id === null ? undefined : quotes[id]
    if (path.startsWith('/v1/market/quote') && quote) {
      return new Response(JSON.stringify({
        quote: {
          listing: { kind: 'listing', id },
          price: 10,
          prev_close: 10,
          change_abs: 0,
          change_pct: 0,
          currency: quote.currency,
          as_of: '2026-10-19T00:00:00.000Z',
          delay_class: 'delayed_15m',
          session_state: 'regular',
          source_id: '00000000-0000-4000-a000-000000000001',
        },
        provenance: { provider: 'polygon_market' },
        listing_context: { ticker: 'AAPL', mic: quote.mic, timezone: 'UTC' },
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
  })
  try {
    const rows = [...rail.section().querySelectorAll('ul[aria-label="Watchlist members"] > li')]
    assert.deepEqual(rows.map((row) => row.querySelector('button')?.getAttribute('aria-label')), [
      'Remove AAPL (XNAS, USD) from watchlist',
      'Remove AAPL (XLON, GBP) from watchlist',
      'Remove symbol 3 from watchlist',
      'Remove symbol 4 from watchlist',
      'Remove AAPL · XNAS — Apple Inc. from watchlist',
      'Remove AAPL · XLON — Apple Inc. from watchlist',
    ])
  } finally {
    await rail.cleanup()
  }
})

test('a row sparkline draws only the latest session and takes its colour from the day change beside it', async () => {
  const LISTING_REF = { kind: 'listing', id: '44444444-4444-4444-a444-444444444444' } as const
  // Thursday rises to 110 and closes there; Friday gaps down to 100, rallies
  // to 108 and fades to 105, still under Thursday's close. The day is down,
  // though Friday's own line and the two-day line both rise. The two sessions
  // have different shapes, so drawing Thursday fails the path check.
  const thursday = [100, 104, 110].map((close, i) => ({ ts: `2026-11-19T${14 + i}:00:00.000Z`, close }))
  const friday = [100, 108, 105].map((close, i) => ({ ts: `2026-11-20T${14 + i}:00:00.000Z`, close }))
  const seriesBodies: Array<{ interval: string; range: { start: string; end: string } }> = []
  const rail = await renderRail((method, path, body) => {
    if (path === MEMBERS_PATH) {
      return new Response(JSON.stringify({ members: [{ subject_ref: LISTING_REF, created_at: '2026-10-19T00:00:00.000Z' }] }), { status: 200 })
    }
    if (method === 'POST' && path === '/v1/market/series') {
      const query = JSON.parse(body) as { subject_refs: unknown[]; interval: string; range: { start: string; end: string } }
      seriesBodies.push(query)
      const bars = [...thursday, ...friday].map((bar) => ({ ...bar, open: bar.close, high: bar.close, low: bar.close, volume: 1 }))
      return new Response(JSON.stringify({ query, results: [{ listing: LISTING_REF, outcome: { outcome: 'available', data: { listing: LISTING_REF, bars } } }] }), { status: 200 })
    }
    if (path.startsWith('/v1/market/quote')) {
      return new Response(JSON.stringify({
        quote: {
          listing: LISTING_REF,
          price: 105,
          prev_close: 110,
          change_abs: -5,
          change_pct: -5 / 110,
          currency: 'USD',
          as_of: '2026-11-20T16:00:00.000Z',
          delay_class: 'delayed_15m',
          session_state: 'closed',
          source_id: '00000000-0000-4000-a000-000000000001',
        },
        provenance: { provider: 'polygon_market' },
        listing_context: { ticker: 'AAPL', mic: 'XNAS', timezone: 'America/New_York' },
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
  })
  try {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    assert.equal(rail.section().querySelector('[aria-label="Watchlist sparkline range"]') === null, true)
    assert.equal(seriesBodies.length, 1)
    assert.notEqual(seriesBodies[0].interval, '1d')
    const line = rail.section().querySelector('svg[aria-label="price trend"] path')!
    assert.equal(line.getAttribute('class'), 'stroke-negative')
    const geometry = computeSparklineGeometry({
      values: friday.map((bar) => bar.close),
      domain: 'auto',
      baseline: null,
      width: SPARKLINE_DEFAULTS.width,
      height: SPARKLINE_DEFAULTS.height,
    })
    assert.equal(line.getAttribute('d'), geometry?.path)
  } finally {
    await rail.cleanup()
  }
})

test('an unquoted row with a flat session draws a muted line, not a rising one', async () => {
  const LISTING_REF = { kind: 'listing', id: '55555555-5555-4555-a555-555555555555' } as const
  const bars = [100, 101, 100].map((close, i) => ({
    ts: `2026-11-20T${14 + i}:00:00.000Z`, open: close, high: close, low: close, close, volume: 1,
  }))
  const rail = await renderRail((method, path, body) => {
    if (path === MEMBERS_PATH) {
      return new Response(JSON.stringify({ members: [{ subject_ref: LISTING_REF, created_at: '2026-10-19T00:00:00.000Z' }] }), { status: 200 })
    }
    if (method === 'POST' && path === '/v1/market/series') {
      return new Response(JSON.stringify({ query: JSON.parse(body), results: [{ listing: LISTING_REF, outcome: { outcome: 'available', data: { listing: LISTING_REF, bars } } }] }), { status: 200 })
    }
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
  })
  try {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    const line = rail.section().querySelector('svg[aria-label="price trend"] path')!
    assert.equal(line.getAttribute('class'), 'stroke-muted')
  } finally {
    await rail.cleanup()
  }
})
