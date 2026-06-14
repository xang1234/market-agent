import assert from 'node:assert/strict'
import test from 'node:test'

import { finiteNumbers, median, numericDistribution } from './distribution.ts'

test('finiteNumbers drops null/undefined/NaN/Infinity', () => {
  assert.deepEqual(finiteNumbers([1, null, 2, undefined, Number.NaN, Number.POSITIVE_INFINITY, 3]), [1, 2, 3])
})

test('median handles odd, even, and empty', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.equal(median([]), null)
})

test('numericDistribution bins finite values across their own range and drops nulls', () => {
  const d = numericDistribution([0, null, 5, 10, Number.NaN], { binCount: 5 })
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
  const d = numericDistribution([7, 7, 7], { binCount: 4 })
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
  assert.equal(d.bins.length, 10) // DEFAULT_BINS
})

test('numericDistribution falls back to the default bin count for an invalid binCount', () => {
  for (const bad of [0, -3, 3.5, Number.NaN]) {
    const d = numericDistribution([1, 2, 3], { binCount: bad })
    assert.equal(d.bins.length, 10)
    assert.equal(d.count, 3)
  }
})

test('numericDistribution bins over a fixed domain and clamps out-of-range values to the edges', () => {
  // domain [0,1]: bins span [0,1] regardless of the data's own range.
  const d = numericDistribution([0.05, 0.15, 0.95, 1.0, 1.4, -0.3], { binCount: 10, domain: [0, 1] })
  assert.equal(d.bins[0].count, 2) // 0.05 in bin 0; -0.3 clamps to bin 0
  assert.equal(d.bins[1].count, 1) // 0.15
  assert.equal(d.bins[9].count, 3) // 0.95, 1.0, and 1.4 all land in the last bin
  // An empty domain'd distribution still spans [0,1].
  const empty = numericDistribution([], { domain: [0, 1] })
  assert.equal(empty.bins.length, 10)
  assert.equal(empty.bins[0].from, 0)
  assert.equal(empty.bins[9].to, 1)
})
