import assert from 'node:assert/strict'
import test from 'node:test'
import {
  quoteRowView,
  type QuoteRowFetchState,
  type QuoteRowView,
} from './quoteRowView.ts'
import type { QuoteSnapshot } from './quote.ts'
import type { SubjectRef } from './search.ts'

const APPLE_LISTING_ID = '11111111-1111-4111-a111-111111111111'
const APPLE_INSTRUMENT_ID = '44444444-4444-4444-a444-444444444444'

const APPLE_LISTING_REF: SubjectRef = { kind: 'listing', id: APPLE_LISTING_ID }
const APPLE_INSTRUMENT_REF: SubjectRef = { kind: 'instrument', id: APPLE_INSTRUMENT_ID }

const APPLE_QUOTE: QuoteSnapshot = {
  subject_ref: APPLE_LISTING_REF,
  listing: { ticker: 'AAPL', mic: 'XNAS', timezone: 'America/New_York' },
  latest_price: 184.32,
  prev_close: 182.5,
  absolute_move: 1.82,
  percent_move: 0.997,
  currency: 'USD',
  as_of: '2026-04-27T20:00:00Z',
  delay_class: 'delayed_15m',
  session_state: 'regular',
  source_id: '00000000-0000-4000-a000-000000000001',
}

const READY_STATE: QuoteRowFetchState = {
  status: 'ready',
  listingId: APPLE_LISTING_ID,
  quote: APPLE_QUOTE,
}

// Snapshot used by the "shared render" verification (cw0.10.1): the
// expected projection of (READY_STATE, APPLE_LISTING_REF) is recorded
// here so any future drift in the watchlist or held surface is caught
// the moment it touches the view shape.
const APPLE_READY_VIEW: QuoteRowView = {
  href: `/symbol/${encodeURIComponent('listing:' + APPLE_LISTING_ID)}/overview`,
  primary: 'AAPL',
  secondary: 'XNAS · USD',
  price: {
    text: '$184.32',
    direction: 'up',
    percent: '+1.00%',
    freshness: 'regular · delayed 15m · 2026-04-27T20:00:00Z',
  },
}

test('quoteRowView projects a ready quote for a listing-kind subject', () => {
  assert.deepStrictEqual(quoteRowView(READY_STATE, APPLE_LISTING_REF), APPLE_READY_VIEW)
})

test('quoteRowView produces identical output on repeated calls (shared-render contract)', () => {
  // The contract from fra-cw0.10.1 says the same subject must render
  // identical values across both watchlist and held surfaces. Both
  // surfaces consume `quoteRowView`; identity is purely a function of
  // its inputs being equal.
  const first = quoteRowView(READY_STATE, APPLE_LISTING_REF)
  const second = quoteRowView(READY_STATE, APPLE_LISTING_REF)
  assert.deepStrictEqual(first, second)
  assert.deepStrictEqual(first, APPLE_READY_VIEW)
})

test('quoteRowView returns a loading view while a listing has not resolved yet', () => {
  const view = quoteRowView({ status: 'idle' }, APPLE_LISTING_REF)
  assert.equal(view.primary, 'Loading…')
  assert.equal(view.secondary, 'listing')
  assert.equal(view.price, null)
})

test('quoteRowView falls back to a truncated id when the listing is unavailable', () => {
  const view = quoteRowView(
    { status: 'unavailable', listingId: APPLE_LISTING_ID },
    APPLE_LISTING_REF,
  )
  assert.equal(view.primary, '11111111…')
  assert.equal(view.secondary, 'listing')
  assert.equal(view.price, null)
})

test('quoteRowView shows the unavailable view for non-listing subjects regardless of state', () => {
  // Held holdings can be instrument-kind (services/portfolio's
  // HOLDING_SUBJECT_KINDS) — those don't resolve to a quote here.
  const view = quoteRowView({ status: 'idle' }, APPLE_INSTRUMENT_REF)
  assert.equal(view.primary, '44444444…')
  assert.equal(view.secondary, 'instrument')
  assert.equal(view.price, null)
})

test('quoteRowView ignores a stale ready state for a different listing', () => {
  // A row that re-keys to a new listingId before the previous fetch
  // resolved must not paint last subject's quote on the new row.
  const otherListingRef: SubjectRef = {
    kind: 'listing',
    id: '22222222-2222-4222-a222-222222222222',
  }
  const view = quoteRowView(READY_STATE, otherListingRef)
  assert.equal(view.price, null)
  assert.equal(view.primary, 'Loading…')
})
