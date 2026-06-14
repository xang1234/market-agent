import assert from 'node:assert/strict'
import test from 'node:test'

import { confidenceDistribution } from './queueStats.ts'

test('confidenceDistribution returns empty bins for an empty queue', () => {
  const d = confidenceDistribution([])
  assert.equal(d.total, 0)
  assert.equal(d.max, 0)
  assert.equal(d.thresholdMarker, null)
  assert.equal(d.bins.length, 10)
  assert.ok(d.bins.every((b) => b.count === 0))
})

test('confidenceDistribution bins confidence across [0,1]', () => {
  const d = confidenceDistribution(
    [
      { confidence: 0.05, threshold: 0.7 },
      { confidence: 0.15, threshold: 0.7 },
      { confidence: 0.95, threshold: 0.7 },
    ],
    10,
  )
  assert.equal(d.bins[0].count, 1) // 0.05 -> bin 0
  assert.equal(d.bins[1].count, 1) // 0.15 -> bin 1
  assert.equal(d.bins[9].count, 1) // 0.95 -> bin 9
  assert.equal(d.max, 1)
  assert.equal(d.total, 3)
})

test('confidenceDistribution puts confidence 1.0 in the last bin, not past it', () => {
  const d = confidenceDistribution([{ confidence: 1, threshold: 0.7 }], 10)
  assert.equal(d.bins[9].count, 1)
})

test('confidenceDistribution clamps out-of-range confidence and threshold', () => {
  const d = confidenceDistribution(
    [
      { confidence: 1.4, threshold: 2 },
      { confidence: -0.3, threshold: -1 },
    ],
    10,
  )
  assert.equal(d.bins[9].count, 1) // 1.4 clamps to 1.0 -> last bin
  assert.equal(d.bins[0].count, 1) // -0.3 clamps to 0 -> first bin
  assert.equal(d.thresholdMarker, 0.5) // median of clamped thresholds [0, 1]
})

test('confidenceDistribution falls back to the default bin count for an invalid binCount', () => {
  for (const bad of [0, -3, 3.5, Number.NaN]) {
    const d = confidenceDistribution([{ confidence: 0.5, threshold: 0.7 }], bad)
    assert.equal(d.bins.length, 10) // DEFAULT_BINS
    assert.equal(d.total, 1)
    assert.equal(d.bins[5].count, 1) // 0.5 still lands in the right bin
  }
})

test('confidenceDistribution medianThreshold handles odd and even counts', () => {
  assert.equal(
    confidenceDistribution([
      { confidence: 0.5, threshold: 0.6 },
      { confidence: 0.5, threshold: 0.8 },
      { confidence: 0.5, threshold: 0.7 },
    ]).thresholdMarker,
    0.7, // odd -> middle of sorted [0.6, 0.7, 0.8]
  )
  assert.equal(
    confidenceDistribution([
      { confidence: 0.5, threshold: 0.5 },
      { confidence: 0.5, threshold: 1.0 },
    ]).thresholdMarker,
    0.75, // even -> mean of [0.5, 1.0] (binary-exact, no float drift)
  )
})
