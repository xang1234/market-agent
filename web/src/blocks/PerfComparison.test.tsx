import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { PerfComparison } from './PerfComparison.tsx'
import type { PerfComparisonBlock } from './types.ts'

const BASE: PerfComparisonBlock = {
  id: 'perf-1',
  kind: 'perf_comparison',
  snapshot_id: '11111111-1111-4111-9111-111111111111',
  data_ref: { kind: 'perf_comparison', id: 'perf-1' },
  source_refs: [],
  as_of: '2026-09-01T00:00:00.000Z',
  subject_refs: [
    { kind: 'listing', id: '62000000-0000-4000-8000-000000000001' },
    { kind: 'listing', id: '62000000-0000-4000-8000-000000000002' },
  ],
  default_range: '1M',
  basis: 'split_and_div_adjusted',
  normalization: 'pct_return',
}

test('PerfComparison draws sealed series from the block, labelled by company, without live ranges', () => {
  const sealed: PerfComparisonBlock = {
    ...BASE,
    default_range: '2026-08-22 to 2026-09-01',
    subject_labels: ['NVDA', 'AMD'],
    series: [
      { name: 'NVDA', unit: '%', points: [{ x: '2026-08-22', y: 0 }, { x: '2026-08-23', y: 10 }] },
      { name: 'AMD', unit: '%', points: [{ x: '2026-08-22', y: 0 }, { x: '2026-08-23', y: -10 }] },
    ],
  }
  const html = renderToStaticMarkup(<PerfComparison block={sealed} />)

  assert.match(html, /data-testid="block-perf-comparison-perf-1-chart"/)
  assert.match(html, />NVDA</)
  assert.match(html, />AMD</)
  assert.match(html, /2026-08-22 to 2026-09-01/)
  // Only the sealed window exists, so there is no live range toggle.
  assert.doesNotMatch(html, /block-perf-comparison-perf-1-range/)
})

test('PerfComparison without sealed series keeps the live range toggle', () => {
  const html = renderToStaticMarkup(<PerfComparison block={BASE} />)
  assert.match(html, /block-perf-comparison-perf-1-range/)
})

test('PerfComparison with explicitly empty sealed series shows it as unavailable, never live data', () => {
  const html = renderToStaticMarkup(<PerfComparison block={{ ...BASE, series: [] }} />)
  assert.doesNotMatch(html, /block-perf-comparison-perf-1-range/)
  assert.doesNotMatch(html, /block-perf-comparison-perf-1-chart/)
  assert.match(html, /No sealed price data/)
})

