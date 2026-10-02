import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MetricRow } from './MetricRow.tsx'
import { metricCellDisplayValue, metricCellHasDelta } from './metricRow.ts'
import type { MetricCell, MetricRowBlock } from './types.ts'

const VALUE_REF = '11111111-1111-4111-9111-111111111111'
const DELTA_REF = '22222222-2222-4222-9222-222222222222'
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333'

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

test('MetricRow renders value refs as inspectable controls', () => {
  const block: MetricRowBlock = {
    id: 'metric-row-1',
    kind: 'metric_row',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: 'metric_row', id: 'metric-row-1' },
    source_refs: [],
    as_of: '2026-05-29T00:00:00.000Z',
    items: [{ label: 'Revenue', value_ref: VALUE_REF }],
  }

  const html = renderToStaticMarkup(createElement(MetricRow, { block }))

  assert.match(html, /data-inspection-kind="fact"/)
  assert.match(html, new RegExp(`data-inspection-id="${VALUE_REF}"`))
})

test('MetricRow inspectable controls render outside the shell inspector provider', () => {
  const block: MetricRowBlock = {
    id: 'metric-row-1',
    kind: 'metric_row',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: 'metric_row', id: 'metric-row-1' },
    source_refs: [],
    as_of: '2026-05-29T00:00:00.000Z',
    items: [{ label: 'Revenue', value_ref: VALUE_REF, format: '$85.8B' }],
  }

  const html = renderToStaticMarkup(createElement(MetricRow, { block }))

  assert.match(html, /\$85\.8B/)
  assert.match(html, /data-inspection-disabled="true"/)
})

test('MetricRow shows its title, so a row of quarterly cells says which margin it is', () => {
  const trend = (title: string): MetricRowBlock => ({
    id: `trend-${title.length}`,
    kind: 'metric_row',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: 'metric_row', id: `trend-${title.length}` },
    source_refs: [],
    as_of: '2026-09-01T00:00:00.000Z',
    title,
    items: [{ label: 'Q2 2025', value_ref: VALUE_REF, format: '-1.7%' }],
  })
  const operating = renderToStaticMarkup(createElement(MetricRow, { block: trend('Operating margin by quarter') }))
  const gross = renderToStaticMarkup(createElement(MetricRow, { block: trend('Gross margin by quarter') }))

  assert.match(operating, /<h4[^>]*>Operating margin by quarter<\/h4>/)
  assert.match(gross, /<h4[^>]*>Gross margin by quarter<\/h4>/)
  assert.match(operating, /aria-label="Operating margin by quarter"/)
})

test('MetricRow without a title renders just the cells', () => {
  const block: MetricRowBlock = {
    id: 'untitled',
    kind: 'metric_row',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: 'metric_row', id: 'untitled' },
    source_refs: [],
    as_of: '2026-09-01T00:00:00.000Z',
    items: [{ label: 'Revenue', value_ref: VALUE_REF, format: '$85.8B' }],
  }

  const html = renderToStaticMarkup(createElement(MetricRow, { block }))

  assert.doesNotMatch(html, /<h4/)
  assert.match(html, /^<ul/)
})
