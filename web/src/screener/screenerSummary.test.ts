import assert from 'node:assert/strict'
import test from 'node:test'

import { screenerSummary } from './screenerSummary.ts'
import type { ScreenerResultRow } from './contracts.ts'

// median + numericDistribution behaviour is covered by symbol/distribution.test.ts.

function row(over: {
  pe?: number | null
  cap?: number | null
  change?: number | null
  currency?: string
}): ScreenerResultRow {
  return {
    subject_ref: { kind: 'issuer', id: 'x' },
    display: { primary: 'X' },
    rank: 1,
    quote: {
      last_price: 100,
      prev_close: 100,
      change_pct: over.change ?? null,
      volume: null,
      delay_class: 'eod',
      currency: over.currency ?? 'USD',
      as_of: '2026-01-01T00:00:00.000Z',
    },
    fundamentals: {
      market_cap: over.cap ?? null,
      pe_ratio: over.pe ?? null,
      gross_margin: null,
      operating_margin: null,
      net_margin: null,
      revenue_growth_yoy: null,
    },
  }
}

test('screenerSummary computes up%, medians, and the P/E distribution over loaded rows', () => {
  const rows = [
    row({ pe: 10, cap: 100e9, change: 0.02 }), // up
    row({ pe: 20, cap: 200e9, change: -0.01 }), // down
    row({ pe: 30, cap: 300e9, change: 0.0 }), // flat (not up)
    row({ pe: null, cap: null, change: null }), // no data
  ]
  const s = screenerSummary(rows)
  assert.equal(s.shown, 4)
  assert.equal(s.upPct, (1 / 3) * 100) // 1 up of 3 with a finite change
  assert.equal(s.medianPe, 20) // median of [10,20,30]
  assert.equal(s.medianMarketCap, 200e9)
  assert.equal(s.peDistribution.count, 3)
  assert.equal(s.peDistribution.median, 20)
  assert.equal(s.marketCapCurrency, 'USD')
})

test('screenerSummary withholds median cap when cap rows span multiple currencies', () => {
  const s = screenerSummary([
    row({ cap: 100e9, currency: 'USD' }),
    row({ cap: 200e9, currency: 'JPY' }), // native caps can't be pooled across FX
  ])
  assert.equal(s.medianMarketCap, null)
  assert.equal(s.marketCapCurrency, null)
})

test('screenerSummary keeps median cap for a single-currency set', () => {
  const s = screenerSummary([
    row({ cap: 100e9, currency: 'USD' }),
    row({ cap: 300e9, currency: 'USD' }),
  ])
  assert.equal(s.medianMarketCap, 200e9)
  assert.equal(s.marketCapCurrency, 'USD')
})
