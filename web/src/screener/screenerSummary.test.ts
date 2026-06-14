import assert from 'node:assert/strict'
import test from 'node:test'

import { median, numericDistribution, screenerSummary } from './screenerSummary.ts'
import type { ScreenerResultRow } from './contracts.ts'

function row(over: { pe?: number | null; cap?: number | null; change?: number | null }): ScreenerResultRow {
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
      currency: 'USD',
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

test('median handles odd, even, and empty', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.equal(median([]), null)
})

test('numericDistribution bins finite values across their range and drops nulls', () => {
  const d = numericDistribution([0, null, 5, 10, Number.NaN], 5)
  assert.equal(d.count, 3) // 0, 5, 10
  assert.equal(d.min, 0)
  assert.equal(d.maxValue, 10)
  assert.equal(d.median, 5)
  assert.equal(d.bins.length, 5)
  assert.equal(d.bins[0].count, 1) // 0 -> first bin
  assert.equal(d.bins[2].count, 1) // 5 -> middle bin
  assert.equal(d.bins[4].count, 1) // 10 -> last bin
  assert.equal(d.max, 1)
})

test('numericDistribution puts an all-equal set in the first bin', () => {
  const d = numericDistribution([7, 7, 7], 4)
  assert.equal(d.bins[0].count, 3)
  assert.equal(d.median, 7)
  assert.equal(d.min, 7)
  assert.equal(d.maxValue, 7)
})

test('numericDistribution returns empty stats for no finite values', () => {
  const d = numericDistribution([null, undefined, Number.NaN])
  assert.equal(d.count, 0)
  assert.equal(d.max, 0)
  assert.equal(d.median, null)
  assert.equal(d.bins.length, 10)
})

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
})
