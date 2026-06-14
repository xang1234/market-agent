import assert from 'node:assert/strict'
import test from 'node:test'

import { moversBars } from './moversBars.ts'
import type { HomeQuoteRow } from './summaryClient.ts'

function row(over: Partial<HomeQuoteRow> & { ticker: string }): HomeQuoteRow {
  return {
    listing: { kind: 'listing', id: over.ticker },
    mic: 'XNAS',
    price: 100,
    prev_close: 100,
    change_abs: 0,
    change_pct: 0,
    session_state: 'regular',
    delay_class: 'real_time',
    as_of: '2026-05-05T00:00:00.000Z',
    currency: 'USD',
    ...over,
  }
}

test('moversBars ranks by absolute move and scales bars to the biggest mover', () => {
  const bars = moversBars([
    row({ ticker: 'A', change_pct: 0.01, change_abs: 1 }),
    row({ ticker: 'B', change_pct: -0.04, change_abs: -4 }),
    row({ ticker: 'C', change_pct: 0.02, change_abs: 2 }),
  ])
  assert.deepEqual(bars.map((b) => b.row.ticker), ['B', 'C', 'A'])
  assert.equal(bars[0].fraction, 1) // |−0.04| is the max
  assert.equal(bars[1].fraction, 0.5) // 0.02 / 0.04
  assert.equal(bars[2].fraction, 0.25) // 0.01 / 0.04
  assert.deepEqual(bars.map((b) => b.direction), ['down', 'up', 'up'])
})

test('moversBars slices to topN after ranking', () => {
  const bars = moversBars(
    [
      row({ ticker: 'A', change_pct: 0.01, change_abs: 1 }),
      row({ ticker: 'B', change_pct: -0.04, change_abs: -4 }),
    ],
    1,
  )
  assert.deepEqual(bars.map((b) => b.row.ticker), ['B'])
})

test('moversBars treats a non-finite move as a zero-length bar sorted last', () => {
  const bars = moversBars([
    row({ ticker: 'good', change_pct: 0.02, change_abs: 2 }),
    row({ ticker: 'nan', change_pct: Number.NaN, change_abs: 0 }),
  ])
  assert.deepEqual(bars.map((b) => b.row.ticker), ['good', 'nan'])
  assert.equal(bars[1].fraction, 0)
})

test('moversBars yields empty bars when nothing moved', () => {
  const bars = moversBars([row({ ticker: 'flat', change_pct: 0, change_abs: 0 })])
  assert.equal(bars[0].fraction, 0)
  assert.equal(bars[0].direction, 'flat')
})
