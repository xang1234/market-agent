import assert from 'node:assert/strict'
import test from 'node:test'
import { perfNormalizationLabel } from './perfComparison.ts'
import { PERF_NORMALIZATIONS } from './types.ts'

test('perfNormalizationLabel returns a non-empty label for every normalization mode', () => {
  for (const mode of PERF_NORMALIZATIONS) {
    const label = perfNormalizationLabel(mode)
    assert.ok(label.length > 0, `expected non-empty label for ${mode}`)
  }
})

test('perfNormalizationLabel returns distinct labels per mode', () => {
  const labels = new Set(PERF_NORMALIZATIONS.map(perfNormalizationLabel))
  assert.equal(labels.size, PERF_NORMALIZATIONS.length)
})
