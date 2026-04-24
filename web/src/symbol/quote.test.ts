import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createQuoteSnapshotStub,
  formatSignedNumber,
  quoteDirection,
  subjectDisplayName,
  type ResolvedSubject,
} from './quote.ts'

const listedSubject: ResolvedSubject = {
  subject_ref: {
    kind: 'listing',
    id: '11111111-1111-4111-a111-111111111111',
  },
  display_name: 'Apple Inc.',
  confidence: 0.95,
  display_labels: {
    primary: 'Apple Inc.',
    ticker: 'AAPL',
    mic: 'XNAS',
  },
  context: {
    issuer: {
      subject_ref: {
        kind: 'issuer',
        id: '33333333-3333-4333-a333-333333333333',
      },
      legal_name: 'Apple Inc.',
      sector: 'Technology',
      industry: 'Consumer Electronics',
    },
    listing: {
      subject_ref: {
        kind: 'listing',
        id: '11111111-1111-4111-a111-111111111111',
      },
      instrument_ref: {
        kind: 'instrument',
        id: '44444444-4444-4444-a444-444444444444',
      },
      issuer_ref: {
        kind: 'issuer',
        id: '33333333-3333-4333-a333-333333333333',
      },
      mic: 'XNAS',
      ticker: 'AAPL',
      trading_currency: 'USD',
      timezone: 'America/New_York',
    },
  },
}

const issuerWithActiveListing: ResolvedSubject = {
  subject_ref: {
    kind: 'issuer',
    id: '33333333-3333-4333-a333-333333333333',
  },
  display_name: 'Apple Inc.',
  confidence: 0.99,
  context: {
    issuer: {
      subject_ref: {
        kind: 'issuer',
        id: '33333333-3333-4333-a333-333333333333',
      },
      legal_name: 'Apple Inc.',
    },
    active_listings: [
      {
        subject_ref: {
          kind: 'listing',
          id: '11111111-1111-4111-a111-111111111111',
        },
        instrument_ref: {
          kind: 'instrument',
          id: '44444444-4444-4444-a444-444444444444',
        },
        issuer_ref: {
          kind: 'issuer',
          id: '33333333-3333-4333-a333-333333333333',
        },
        mic: 'XNAS',
        ticker: 'AAPL',
        trading_currency: 'USD',
        timezone: 'America/New_York',
      },
    ],
  },
}

test('createQuoteSnapshotStub returns the P1.1-compatible quote shape', () => {
  const quote = createQuoteSnapshotStub(listedSubject)

  assert.deepEqual(quote.subject_ref, listedSubject.subject_ref)
  assert.equal(quote.listing.ticker, 'AAPL')
  assert.equal(quote.listing.mic, 'XNAS')
  assert.equal(quote.currency, 'USD')
  assert.equal(quote.delay_class, 'delayed')
  assert.equal(quote.source_id, 'p1.1-stub')
  assert.equal(typeof quote.as_of, 'string')
  assert.ok(Number.isFinite(quote.latest_price))
  assert.ok(Number.isFinite(quote.absolute_move))
  assert.ok(Number.isFinite(quote.percent_move))
  assert.ok(quote.recent_range.length >= 5)
})

test('createQuoteSnapshotStub stays listing-oriented when issuer context exists', () => {
  const quote = createQuoteSnapshotStub(listedSubject)

  assert.deepEqual(quote.subject_ref, listedSubject.subject_ref)
  assert.equal(quote.listing.ticker, 'AAPL')
  assert.equal(quote.issuer_profile?.legal_name, 'Apple Inc.')
  assert.equal(quote.issuer_profile?.sector, 'Technology')
})

test('createQuoteSnapshotStub uses active listing identity for issuer entries', () => {
  const quote = createQuoteSnapshotStub(issuerWithActiveListing)

  assert.deepEqual(quote.subject_ref, {
    kind: 'listing',
    id: '11111111-1111-4111-a111-111111111111',
  })
  assert.equal(quote.listing.ticker, 'AAPL')
  assert.equal(quote.listing.mic, 'XNAS')
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
      subject_ref: {
        kind: 'listing',
        id: '55555555-5555-4555-a555-555555555555',
      },
      display_name: 'Microsoft Corp.',
      confidence: 0.94,
    }),
    'Microsoft Corp.',
  )
})
