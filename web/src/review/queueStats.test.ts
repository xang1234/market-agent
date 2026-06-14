import assert from 'node:assert/strict'
import test from 'node:test'

import { confidenceDistribution } from './queueStats.ts'

// The pure binning behaviour is covered by symbol/distribution.test.ts; these
// tests cover the confidence-specific wrapper (the [0,1] domain + the median
// threshold marker).

test('confidenceDistribution bins confidence over the fixed [0,1] domain', () => {
  const d = confidenceDistribution(
    [
      { confidence: 0.05, threshold: 0.7 },
      { confidence: 0.15, threshold: 0.7 },
      { confidence: 0.95, threshold: 0.7 },
    ],
    10,
  )
  assert.equal(d.bins.length, 10)
  assert.equal(d.bins[0].count, 1) // 0.05
  assert.equal(d.bins[1].count, 1) // 0.15
  assert.equal(d.bins[9].count, 1) // 0.95
  assert.equal(d.count, 3)
})

test('confidenceDistribution reports the median threshold (clamped), null when empty', () => {
  assert.equal(confidenceDistribution([]).thresholdMarker, null)
  assert.equal(
    confidenceDistribution([
      { confidence: 0.5, threshold: 0.6 },
      { confidence: 0.5, threshold: 0.8 },
      { confidence: 0.5, threshold: 0.7 },
    ]).thresholdMarker,
    0.7, // odd -> middle of [0.6, 0.7, 0.8]
  )
  assert.equal(
    confidenceDistribution([
      { confidence: 0.5, threshold: 0.5 },
      { confidence: 0.5, threshold: 1.0 },
    ]).thresholdMarker,
    0.75, // even -> mean of [0.5, 1.0]
  )
  assert.equal(
    confidenceDistribution([
      { confidence: 0.5, threshold: 2 },
      { confidence: 0.5, threshold: -1 },
    ]).thresholdMarker,
    0.5, // thresholds clamp to [0,1] -> median of [0, 1]
  )
})
