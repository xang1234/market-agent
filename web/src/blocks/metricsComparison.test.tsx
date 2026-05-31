import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { MetricsComparison } from './MetricsComparison.tsx'
import { metricsComparisonFixture } from './fixtures.ts'
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
