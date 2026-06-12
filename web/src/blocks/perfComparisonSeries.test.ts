import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { GetSeriesResponse } from '../symbol/series.ts'
import {
  perfRangeDays,
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

test('perfRangeDays understands the labeled ranges', () => {
  const now = new Date('2026-06-12T00:00:00Z')
  assert.equal(perfRangeDays('1M', now), 30)
  assert.equal(perfRangeDays('YTD', now), 162)
  assert.equal(perfRangeDays('5Y', now), 1825)
  assert.equal(perfRangeDays('bogus', now), null)
})

test('perfSeriesQuery uses listings only, pct_return normalization', () => {
  const query = perfSeriesQuery(block, 'YTD', new Date('2026-06-12T00:00:00Z'))
  assert.ok(query !== null)
  assert.deepEqual(query.subject_refs.map((ref) => ref.id), ['l-1'])
  assert.equal(query.normalization, 'pct_return')
  assert.equal(query.interval, '1d')
})

test('perfSeriesQuery returns null for unknown range or no listings', () => {
  assert.equal(perfSeriesQuery(block, 'bogus', new Date()), null)
  const noListings = { ...block, subject_refs: [{ kind: 'issuer', id: 'i-1' }] } as PerfComparisonBlock
  assert.equal(perfSeriesQuery(noListings, 'YTD', new Date()), null)
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
