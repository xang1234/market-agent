import assert from 'node:assert/strict'
import test from 'node:test'
import { quoteRowView, type QuoteRowState, type QuoteRowView } from './quoteRowView.ts'
import type { QuoteSnapshot } from './quote.ts'
import type { ResolvedSubject, SubjectRef } from './search.ts'
import type { VisibleFetchState } from '../fetch/resource.ts'
import { readableDate } from '../evidence/readable.ts'

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
  provider: 'polygon_market',
}

const READY_STATE: QuoteRowState = {
  status: 'ready',
  data: APPLE_QUOTE,
  refreshing: false,
  refreshError: null,
}

const APPLE_READY_VIEW: QuoteRowView = {
  href: `/symbol/${encodeURIComponent('listing:' + APPLE_LISTING_ID)}/overview`,
  primary: 'AAPL',
  secondary: 'XNAS · USD',
  label: 'AAPL (XNAS, USD)',
  price: {
    text: '$184.32',
    direction: 'up',
    percent: '+1.00%',
    freshness: `regular · delayed 15m · ${readableDate('2026-04-27T20:00:00Z')}`,
  },
}

const UNNAMED: VisibleFetchState<ResolvedSubject> = { status: 'idle' }

function named(subject: Omit<ResolvedSubject, 'subject_ref' | 'confidence'>): VisibleFetchState<ResolvedSubject> {
  return { status: 'ready', data: { subject_ref: APPLE_INSTRUMENT_REF, confidence: 1, ...subject }, refreshing: false, refreshError: null }
}

const UNAVAILABLE_QUOTE: QuoteRowState = { status: 'unavailable', reason: 'listing mismatch', retry: () => {} }

test('quoteRowView projects a ready quote for a listing-kind subject', () => {
  assert.deepStrictEqual(quoteRowView(READY_STATE, APPLE_LISTING_REF, UNNAMED), APPLE_READY_VIEW)
})

test('quoteRowView blanks the name while the quote loads', () => {
  const view = quoteRowView({ status: 'loading' }, APPLE_LISTING_REF, UNNAMED)
  assert.deepStrictEqual([view.primary, view.secondary, view.price], [null, '', null])
})

test('a row whose quote failed is named by its subject and says the quote is unavailable', () => {
  const view = quoteRowView(UNAVAILABLE_QUOTE, APPLE_LISTING_REF, named({ display_labels: { primary: 'AAPL' } }))
  assert.deepStrictEqual([view.primary, view.secondary, view.price], ['AAPL', 'Quote unavailable', null])
})

test('a row with no quote to fetch is named by its subject and says it has no quote', () => {
  const view = quoteRowView({ status: 'idle' }, APPLE_INSTRUMENT_REF, named({ display_name: 'Apple Inc.' }))
  assert.deepStrictEqual([view.primary, view.secondary, view.price], ['Apple Inc.', 'No quote', null])
})

test('a row whose name is still loading shows no name, not "Unknown symbol"', () => {
  assert.equal(quoteRowView({ status: 'idle' }, APPLE_INSTRUMENT_REF, { status: 'loading' }).primary, null)
  assert.equal(quoteRowView(UNAVAILABLE_QUOTE, APPLE_LISTING_REF, { status: 'loading' }).primary, null)
})

test('a row whose name lookup failed gets the neutral "Symbol"', () => {
  const view = quoteRowView(UNAVAILABLE_QUOTE, APPLE_LISTING_REF, { status: 'unavailable', reason: 'HTTP 503', retry: () => {} })
  assert.deepStrictEqual([view.primary, view.secondary], ['Symbol', 'Quote unavailable'])
})

test('only a subject that hydrates without any name is "Unknown symbol"', () => {
  assert.equal(quoteRowView({ status: 'idle' }, APPLE_INSTRUMENT_REF, named({})).primary, 'Unknown symbol')
})

test('a row labels the control beside it with its real name, and gives a placeholder no label', () => {
  const label = (state: QuoteRowState, subject: VisibleFetchState<ResolvedSubject>) => quoteRowView(state, APPLE_LISTING_REF, subject).label
  assert.deepStrictEqual(
    [
      label(UNAVAILABLE_QUOTE, named({ display_labels: { primary: 'AAPL' } })),
      label({ status: 'loading' }, UNNAMED),
      label(UNAVAILABLE_QUOTE, { status: 'loading' }),
      label(UNAVAILABLE_QUOTE, { status: 'unavailable', reason: 'HTTP 503', retry: () => {} }),
      label({ status: 'idle' }, named({})),
    ],
    ['AAPL', null, null, null, null],
  )
})

test('a row with no quote labels its control with the exchange its subject is listed on', () => {
  const view = quoteRowView(UNAVAILABLE_QUOTE, APPLE_LISTING_REF, named({ display_labels: { primary: 'AAPL', ticker: 'AAPL', mic: 'XNAS' } }))
  assert.deepStrictEqual([view.primary, view.label], ['AAPL', 'AAPL (XNAS)'])
})

test('a row whose name already carries its exchange does not repeat it in the label', () => {
  const primary = 'AAPL · XNAS — Apple Inc.'
  const view = quoteRowView(UNAVAILABLE_QUOTE, APPLE_LISTING_REF, named({ display_labels: { primary, ticker: 'AAPL', mic: 'XNAS' } }))
  assert.deepStrictEqual([view.primary, view.label], [primary, primary])
})
