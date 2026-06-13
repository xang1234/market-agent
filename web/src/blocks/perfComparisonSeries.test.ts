import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { GetSeriesResponse } from '../symbol/series.ts'
import {
  perfAnchor,
  perfRangeOptions,
  perfSeriesQuery,
  seriesFromPerfResponse,
} from './perfComparisonSeries.ts'
import type { PerfComparisonBlock } from './types.ts'

const block = {
  id: 'b1',
  kind: 'perf_comparison',
  snapshot_id: 's',
  data_ref: { kind: 'k', id: 'i' },
  source_refs: [],
  as_of: '2026-06-12T00:00:00Z',
  subject_refs: [
    { kind: 'listing', id: 'l-1' },
    { kind: 'issuer', id: 'i-1' },
  ],
  default_range: 'YTD',
  basis: 'split_and_div_adjusted',
  normalization: 'pct_return',
} as unknown as PerfComparisonBlock

test('range options come from interactive.ranges with fallback defaults', () => {
  assert.deepEqual([...perfRangeOptions(block)], ['1M', '3M', '6M', 'YTD', '1Y'])
  const withSpec = { ...block, interactive: { ranges: ['5D', '1Y'] } } as PerfComparisonBlock
  assert.deepEqual([...perfRangeOptions(withSpec)], ['5D', '1Y'])
})

test('series fetches are anchored at the pinned block moment, never "now"', () => {
  // Sealed-snapshot contract: as_of anchors the range end…
  assert.equal(perfAnchor(block).toISOString(), '2026-06-12T00:00:00.000Z')
  const query = perfSeriesQuery(block, 'YTD')
  assert.ok(query !== null)
  assert.equal(query.range.end, '2026-06-12T00:00:00.000Z')
  // …YTD resolves against that anchor (2026-01-01 → 2026-06-12 is 162 days)…
  assert.equal(
    (Date.parse(query.range.end) - Date.parse(query.range.start)) / (24 * 60 * 60 * 1000),
    162,
  )
  // …and an explicit interactive.range_end_max takes precedence over as_of.
  const withMax = {
    ...block,
    interactive: { range_end_max: '2026-03-31T00:00:00Z' },
  } as PerfComparisonBlock
  assert.equal(perfSeriesQuery(withMax, '1M')?.range.end, '2026-03-31T00:00:00.000Z')
})

test('perfSeriesQuery uses listings only, pct_return normalization', () => {
  const query = perfSeriesQuery(block, 'YTD')
  assert.ok(query !== null)
  assert.deepEqual(query.subject_refs.map((ref) => ref.id), ['l-1'])
  assert.equal(query.normalization, 'pct_return')
  assert.equal(query.interval, '1d')
})

test('perfSeriesQuery returns null for unknown range or no listings', () => {
  assert.equal(perfSeriesQuery(block, 'bogus'), null)
  const noListings = { ...block, subject_refs: [{ kind: 'issuer', id: 'i-1' }] } as PerfComparisonBlock
  assert.equal(perfSeriesQuery(noListings, 'YTD'), null)
})

test('seriesFromPerfResponse converts bars to chart series named by listing', () => {
  const response = {
    query: {} as never,
    results: [
      {
        listing: { kind: 'listing', id: 'l-1' },
        outcome: {
          outcome: 'available',
          data: {
            bars: [
              { ts: '2026-01-02T00:00:00Z', close: 0 },
              { ts: '2026-01-03T00:00:00Z', close: 4.2 },
            ],
          },
        },
      },
      {
        listing: { kind: 'listing', id: 'l-2' },
        outcome: { outcome: 'unavailable', reason: 'missing_coverage' },
      },
    ],
  } as unknown as GetSeriesResponse
  const series = seriesFromPerfResponse(response)
  assert.equal(series.length, 1)
  assert.equal(series[0].unit, '%')
  assert.equal(series[0].points.length, 2)
  assert.equal(series[0].points[1].y, 4.2)
  assert.equal(series[0].points[1].x, '2026-01-03')
})
