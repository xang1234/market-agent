import assert from 'node:assert/strict'
import test from 'node:test'
import { metricCellDisplayValue, metricCellHasDelta } from './metricRow.ts'
import type { MetricCell } from './types.ts'

const VALUE_REF = '11111111-1111-4111-9111-111111111111'
const DELTA_REF = '22222222-2222-4222-9222-222222222222'

test('metricCellDisplayValue returns the format hint when provided', () => {
  const cell: MetricCell = { label: 'Revenue', value_ref: VALUE_REF, format: '$85.8B' }
  assert.equal(metricCellDisplayValue(cell), '$85.8B')
})

test('metricCellDisplayValue falls back to em-dash when format is missing or empty', () => {
  const noFormat: MetricCell = { label: 'Revenue', value_ref: VALUE_REF }
  const emptyFormat: MetricCell = { label: 'Revenue', value_ref: VALUE_REF, format: '' }
  assert.equal(metricCellDisplayValue(noFormat), '—')
  assert.equal(metricCellDisplayValue(emptyFormat), '—')
})

test('metricCellHasDelta tracks presence of a non-empty delta_ref', () => {
  const withDelta: MetricCell = { label: 'Revenue', value_ref: VALUE_REF, delta_ref: DELTA_REF }
  const empty: MetricCell = { label: 'Revenue', value_ref: VALUE_REF, delta_ref: '' }
  const missing: MetricCell = { label: 'Revenue', value_ref: VALUE_REF }
  assert.equal(metricCellHasDelta(withDelta), true)
  assert.equal(metricCellHasDelta(empty), false)
  assert.equal(metricCellHasDelta(missing), false)
})
