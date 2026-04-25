import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchQuoteSnapshot,
  formatSignedNumber,
  issuerProfileFromSubject,
  listingIdForQuote,
  quoteBelongsToListing,
  QuoteFetchError,
  quoteDirection,
  snapshotFromWire,
  subjectDisplayName,
  type QuoteSnapshot,
  type ResolvedSubject,
} from './quote.ts'

const APPLE_LISTING_ID = '11111111-1111-4111-a111-111111111111'
const MICROSOFT_LISTING_ID = '22222222-2222-4222-a222-222222222222'
const APPLE_ISSUER_ID = '33333333-3333-4333-a333-333333333333'
const POLYGON_SOURCE_ID = '00000000-0000-4000-a000-000000000001'

const listedSubject: ResolvedSubject = {
  subject_ref: { kind: 'listing', id: APPLE_LISTING_ID },
  display_name: 'Apple Inc.',
  confidence: 0.95,
  display_labels: { primary: 'Apple Inc.', ticker: 'AAPL', mic: 'XNAS' },
  context: {
    issuer: {
      subject_ref: { kind: 'issuer', id: APPLE_ISSUER_ID },
      legal_name: 'Apple Inc.',
      sector: 'Technology',
      industry: 'Consumer Electronics',
    },
  },
}

const issuerWithActiveListing: ResolvedSubject = {
  subject_ref: { kind: 'issuer', id: APPLE_ISSUER_ID },
  display_name: 'Apple Inc.',
  confidence: 0.99,
  context: {
    issuer: { subject_ref: { kind: 'issuer', id: APPLE_ISSUER_ID }, legal_name: 'Apple Inc.' },
    active_listings: [
      {
        subject_ref: { kind: 'listing', id: APPLE_LISTING_ID },
        instrument_ref: { kind: 'instrument', id: '44444444-4444-4444-a444-444444444444' },
        issuer_ref: { kind: 'issuer', id: APPLE_ISSUER_ID },
        mic: 'XNAS',
        ticker: 'AAPL',
        trading_currency: 'USD',
        timezone: 'America/New_York',
      },
    ],
  },
}

const baseWireResponse = {
  quote: {
    listing: { kind: 'listing' as const, id: APPLE_LISTING_ID },
    price: 196.58,
    prev_close: 195.34,
    change_abs: 1.24,
    change_pct: 0.006348,
    session_state: 'regular' as const,
    as_of: '2026-04-22T15:30:00.000Z',
    delay_class: 'delayed_15m' as const,
    currency: 'USD',
    source_id: POLYGON_SOURCE_ID,
  },
  listing_context: { ticker: 'AAPL', mic: 'XNAS', timezone: 'America/New_York' },
}

test('snapshotFromWire converts a backend GetQuoteResponse into a QuoteSnapshot', () => {
  const snapshot = snapshotFromWire(baseWireResponse)

  assert.deepEqual(snapshot.subject_ref, { kind: 'listing', id: APPLE_LISTING_ID })
  assert.equal(snapshot.listing.ticker, 'AAPL')
  assert.equal(snapshot.listing.mic, 'XNAS')
  assert.equal(snapshot.listing.timezone, 'America/New_York')
  assert.equal(snapshot.latest_price, 196.58)
  assert.equal(snapshot.prev_close, 195.34)
  assert.equal(snapshot.absolute_move, 1.24)
  // change_pct (fraction) becomes percent_move (percentage points)
  assert.ok(Math.abs(snapshot.percent_move - 0.6348) < 1e-6)
  assert.equal(snapshot.currency, 'USD')
  assert.equal(snapshot.delay_class, 'delayed_15m')
  assert.equal(snapshot.session_state, 'regular')
  // Verification clause: the live source_id surfaces in the snapshot.
  assert.equal(snapshot.source_id, POLYGON_SOURCE_ID)
  assert.notEqual(snapshot.source_id, 'p1.1-stub')
})

test('listingIdForQuote uses subject_ref.id directly for listing-kind subjects', () => {
  assert.equal(listingIdForQuote(listedSubject), APPLE_LISTING_ID)
})

test('listingIdForQuote falls back to active_listings[0] for issuer-kind subjects', () => {
  assert.equal(listingIdForQuote(issuerWithActiveListing), APPLE_LISTING_ID)
})

test('listingIdForQuote returns null when no listing context is available', () => {
  const issuerOnly: ResolvedSubject = {
    subject_ref: { kind: 'issuer', id: APPLE_ISSUER_ID },
    display_name: 'Apple Inc.',
    confidence: 0.99,
  }
  assert.equal(listingIdForQuote(issuerOnly), null)
})

test('quoteBelongsToListing rejects snapshots fetched for a previous listing', () => {
  const snapshot = snapshotFromWire(baseWireResponse)

  assert.equal(quoteBelongsToListing(snapshot, APPLE_LISTING_ID), true)
  assert.equal(quoteBelongsToListing(snapshot, MICROSOFT_LISTING_ID), false)
  assert.equal(quoteBelongsToListing(snapshot, null), false)
})

test('fetchQuoteSnapshot calls the listing-id-bound market endpoint and decodes the response', async () => {
  let calledUrl: string | null = null
  const mockFetch = (async (url: string | URL) => {
    calledUrl = String(url)
    return new Response(JSON.stringify(baseWireResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const snapshot = await fetchQuoteSnapshot(APPLE_LISTING_ID, { fetchImpl: mockFetch })
  assert.match(calledUrl ?? '', /\/v1\/market\/quote\?subject_kind=listing&subject_id=11111111/)
  assert.equal(snapshot.source_id, POLYGON_SOURCE_ID)
  assert.equal(snapshot.listing.ticker, 'AAPL')
})

test('fetchQuoteSnapshot throws QuoteFetchError on non-2xx responses with the status preserved', async () => {
  const mockFetch = (async () =>
    new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

  await assert.rejects(
    fetchQuoteSnapshot(APPLE_LISTING_ID, { fetchImpl: mockFetch }),
    (err: unknown) => err instanceof QuoteFetchError && err.status === 404,
  )
})

test('fetchQuoteSnapshot URL-encodes the listing id', async () => {
  let calledUrl: string | null = null
  const mockFetch = (async (url: string | URL) => {
    calledUrl = String(url)
    return new Response(JSON.stringify(baseWireResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  await fetchQuoteSnapshot('weird id with spaces', { fetchImpl: mockFetch })
  assert.match(calledUrl ?? '', /weird%20id%20with%20spaces/)
})

test('issuerProfileFromSubject extracts only the relevant issuer display fields', () => {
  const profile = issuerProfileFromSubject(listedSubject)
  assert.deepEqual(profile, {
    legal_name: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
  })
})

test('issuerProfileFromSubject returns null when no issuer context exists', () => {
  const noIssuer: ResolvedSubject = {
    subject_ref: { kind: 'listing', id: APPLE_LISTING_ID },
    display_name: 'Apple Inc.',
    confidence: 0.95,
  }
  assert.equal(issuerProfileFromSubject(noIssuer), null)
})

test('quote formatting keeps signed moves explicit', () => {
  assert.equal(formatSignedNumber(1.24), '+1.24')
  assert.equal(formatSignedNumber(-0.4), '-0.40')
  assert.equal(formatSignedNumber(0), '0.00')
  assert.equal(quoteDirection({ absolute_move: 1.24 }), 'up')
  assert.equal(quoteDirection({ absolute_move: -0.4 }), 'down')
  assert.equal(quoteDirection({ absolute_move: 0 }), 'flat')
})

test('subjectDisplayName falls back to resolver display_name before raw subject ref', () => {
  assert.equal(
    subjectDisplayName({
      subject_ref: { kind: 'listing', id: '55555555-5555-4555-a555-555555555555' },
      display_name: 'Microsoft Corp.',
      confidence: 0.94,
    }),
    'Microsoft Corp.',
  )
})

test('QuoteSnapshot type does not retain stub-only fields', () => {
  // Compile-time assertion: QuoteSnapshot used to carry display_name,
  // recent_range, and issuer_profile from the stub days. They now live on
  // ResolvedSubject (display) or are deferred to P1.1b (recent_range).
  const sample: QuoteSnapshot = snapshotFromWire(baseWireResponse)
  // @ts-expect-error — display_name is no longer on QuoteSnapshot
  assert.equal(sample.display_name, undefined)
  // @ts-expect-error — recent_range is no longer on QuoteSnapshot
  assert.equal(sample.recent_range, undefined)
  // @ts-expect-error — issuer_profile is no longer on QuoteSnapshot
  assert.equal(sample.issuer_profile, undefined)
})
