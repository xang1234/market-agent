import assert from 'node:assert/strict'
import test from 'node:test'
import { quoteRowView, type QuoteRowState, type QuoteRowView } from './quoteRowView.ts'
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

const READY_STATE: QuoteRowState = { status: 'ready', data: APPLE_QUOTE }

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
  const first = quoteRowView(READY_STATE, APPLE_LISTING_REF)
  const second = quoteRowView(READY_STATE, APPLE_LISTING_REF)
  assert.deepStrictEqual(first, second)
  assert.deepStrictEqual(first, APPLE_READY_VIEW)
})

test('quoteRowView returns a loading view while a listing has not resolved yet', () => {
  const view = quoteRowView({ status: 'loading' }, APPLE_LISTING_REF)
  assert.equal(view.primary, 'Loading…')
  assert.equal(view.secondary, 'listing')
  assert.equal(view.price, null)
})

test('quoteRowView falls back to a truncated id when the listing is unavailable', () => {
  const view = quoteRowView(
    { status: 'unavailable', reason: 'listing mismatch' },
    APPLE_LISTING_REF,
  )
  assert.equal(view.primary, '11111111…')
  assert.equal(view.secondary, 'listing')
  assert.equal(view.price, null)
})

test('quoteRowView shows an idle view for non-listing subjects (no fetch keyed)', () => {
  // useFetched returns 'idle' when its key is null — the case for held
  // holdings whose subject_ref is instrument-kind (HOLDING_SUBJECT_KINDS
  // in services/portfolio/src/holdings.ts).
  const view = quoteRowView({ status: 'idle' }, APPLE_INSTRUMENT_REF)
  assert.equal(view.primary, '44444444…')
  assert.equal(view.secondary, 'instrument')
  assert.equal(view.price, null)
})
