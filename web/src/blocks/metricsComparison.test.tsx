import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { MetricsComparison } from './MetricsComparison.tsx'
import { emittedMetricsComparisonFixture, metricsComparisonFixture } from './fixtures.ts'
import { validateBlock } from './BlockValidator.ts'
import type { MetricsComparisonBlock } from './types.ts'

test('MetricsComparison renders formatted cell values, tones, and the primary-subject row', () => {
  const html = renderToStaticMarkup(<MetricsComparison block={metricsComparisonFixture} />)

  // Pre-formatted display values appear (the `format` string is what renders).
  assert.match(html, /\$385\.7B/)
  assert.match(html, /69\.8%/)
  assert.match(html, /34\.6×/)

  // Tone coloring is applied (positive + negative cells exist in the fixture).
  assert.match(html, /text-positive/)
  assert.match(html, /text-negative/)

  // The primary subject's row is flagged + highlighted.
  assert.match(html, /data-primary="true"/)
  assert.match(html, /bg-accent-soft/)
})

test('MetricsComparison wires present cells to their backing fact via InspectableRef', () => {
  const html = renderToStaticMarkup(<MetricsComparison block={metricsComparisonFixture} />)

  // A present cell exposes its fact for inspection; a gap cell does not.
  const firstCellRef = metricsComparisonFixture.cells?.[0]?.[0]
  assert.ok(firstCellRef)
  assert.match(html, /data-inspection-kind="fact"/)
  assert.match(html, new RegExp(`data-inspection-id="${firstCellRef.value_ref}"`))
})

test('MetricsComparison falls back to em-dashes when a block carries no cells', () => {
  const block: MetricsComparisonBlock = {
    id: 'mc-empty',
    kind: 'metrics_comparison',
    snapshot_id: '11111111-1111-4111-9111-111111111111',
    data_ref: { kind: 'metrics_comparison', id: 'mc-empty' },
    source_refs: [],
    as_of: '2024-09-30T00:00:00.000Z',
    subjects: [{ kind: 'issuer', id: '99999999-9999-4999-9999-999999999991' }],
    metrics: ['Revenue', 'P/E'],
  }

  const html = renderToStaticMarkup(<MetricsComparison block={block} />)
  assert.doesNotMatch(html, /data-primary="true"/)
  // Two metric columns, no cells -> two em-dash placeholders.
  assert.equal(html.split('—').length - 1, 2)
})

test('MetricsComparison renders a null cell as a gap em-dash alongside present cells', () => {
  const block: MetricsComparisonBlock = {
    id: 'mc-gap',
    kind: 'metrics_comparison',
    snapshot_id: '11111111-1111-4111-9111-111111111111',
    data_ref: { kind: 'metrics_comparison', id: 'mc-gap' },
    source_refs: [],
    as_of: '2024-09-30T00:00:00.000Z',
    subjects: [{ kind: 'issuer', id: '99999999-9999-4999-9999-999999999991' }],
    metrics: ['Revenue', 'P/E'],
    cells: [[{ value_ref: '22222222-2222-4222-9222-000000000001', format: '$385.7B' }, null]],
  }

  const html = renderToStaticMarkup(<MetricsComparison block={block} />)
  assert.match(html, /\$385\.7B/)
  // The null P/E cell renders one em-dash; the present revenue cell does not.
  assert.equal(html.split('—').length - 1, 1)
})

// --- E2E: an emitted-shape block round-trips through the web contract ---

test('the emitted metrics_comparison block passes the web BlockValidator (AJV/schema)', () => {
  // Exercises the emitter's exact output shape: data_ref.params.fact_bindings,
  // a null gap cell, tones, and primary_subject_ref.
  const result = validateBlock(emittedMetricsComparisonFixture)
  assert.equal(result.valid, true, result.valid ? '' : JSON.stringify(result.errors, null, 2))
})

test('the emitted metrics_comparison block renders cells, a tone, a gap, and an inspect affordance', () => {
  const html = renderToStaticMarkup(<MetricsComparison block={emittedMetricsComparisonFixture} />)

  assert.match(html, /\$391\.0B/)
  assert.match(html, /29\.1×/)
  // The toned P/E cell.
  assert.match(html, /text-positive/)
  // MSFT's missing P/E is the single gap.
  assert.equal(html.split('—').length - 1, 1)
  // Present cells link to their backing fact.
  assert.match(html, /data-inspection-id="55555555-5555-4555-9555-000000000001"/)
})
