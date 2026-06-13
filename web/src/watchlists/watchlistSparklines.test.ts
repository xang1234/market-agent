import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { GetSeriesResponse } from '../symbol/series.ts'
import {
  WATCHLIST_WINDOWS,
  sparklineClosesByListing,
  watchlistSeriesQuery,
} from './watchlistSparklines.ts'

test('window list drives the rail toggle', () => {
  assert.deepEqual([...WATCHLIST_WINDOWS], ['5D', '1M', '6M', 'YTD', '1Y'])
})

test('watchlistSeriesQuery batches only listing-kind members into one query', () => {
  const query = watchlistSeriesQuery(
    [
      { kind: 'listing', id: 'l-1' },
      { kind: 'issuer', id: 'i-1' },
      { kind: 'listing', id: 'l-2' },
    ],
    '1M',
    new Date('2026-06-12T00:00:00Z'),
  )
  assert.ok(query !== null)
  assert.deepEqual(query.subject_refs.map((ref) => ref.id), ['l-1', 'l-2'])
  assert.equal(query.interval, '1d')
  assert.equal(query.basis, 'split_and_div_adjusted')
  assert.equal(query.normalization, 'raw')
  assert.equal(query.range.end, '2026-06-12T00:00:00.000Z')
})

test('watchlistSeriesQuery returns null with no listing members', () => {
  assert.equal(
    watchlistSeriesQuery([{ kind: 'issuer', id: 'i-1' }], '1M', new Date()),
    null,
  )
})

test('sparklineClosesByListing keeps available outcomes only', () => {
  const response = {
    query: {} as never,
    results: [
      {
        listing: { kind: 'listing', id: 'l-1' },
        outcome: {
          outcome: 'available',
          data: { bars: [{ close: 1 }, { close: 2 }] },
        },
      },
      {
        listing: { kind: 'listing', id: 'l-2' },
        outcome: { outcome: 'unavailable', reason: 'missing_coverage' },
      },
    ],
  } as unknown as GetSeriesResponse
  const map = sparklineClosesByListing(response)
  assert.deepEqual(map.get('l-1'), [1, 2])
  assert.equal(map.has('l-2'), false)
})
