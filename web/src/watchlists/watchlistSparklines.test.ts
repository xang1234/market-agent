import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { GetSeriesResponse } from '../symbol/series.ts'
import { sparklineClosesByListing, watchlistSeriesQuery } from './watchlistSparklines.ts'

test('watchlistSeriesQuery batches only listing-kind members into one query', () => {
  const query = watchlistSeriesQuery(
    [
      { kind: 'listing', id: 'l-1' },
      { kind: 'issuer', id: 'i-1' },
      { kind: 'listing', id: 'l-2' },
    ],
    new Date('2026-06-12T00:00:00Z'),
  )
  assert.ok(query !== null)
  assert.deepEqual(query.subject_refs.map((ref) => ref.id), ['l-1', 'l-2'])
  assert.equal(query.interval, '15m')
  assert.equal(query.range.start, '2026-06-05T00:00:00.000Z')
  assert.equal(query.basis, 'split_adjusted')
  assert.equal(query.normalization, 'raw')
  assert.equal(query.range.end, '2026-06-12T00:00:00.000Z')
})

test('watchlistSeriesQuery returns null with no listing members', () => {
  assert.equal(
    watchlistSeriesQuery([{ kind: 'issuer', id: 'i-1' }], new Date()),
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

test('sparklineClosesByListing keeps the latest session, after an overnight or weekend gap', () => {
  const bar = (ts: string, close: number) => ({ ts, close })
  const response = {
    query: {} as never,
    results: [
      {
        // Thursday after-hours, then Friday from pre-market to after-hours.
        listing: { kind: 'listing', id: 'overnight' },
        outcome: {
          outcome: 'available',
          data: {
            bars: [
              bar('2026-11-20T00:45:00.000Z', 1),
              bar('2026-11-20T09:00:00.000Z', 2),
              bar('2026-11-20T12:30:00.000Z', 3),
              bar('2026-11-20T16:00:00.000Z', 4),
              bar('2026-11-20T19:30:00.000Z', 5),
              bar('2026-11-20T23:00:00.000Z', 6),
              bar('2026-11-21T00:45:00.000Z', 7),
            ],
          },
        },
      },
      {
        // Friday's close, then Monday's open.
        listing: { kind: 'listing', id: 'weekend' },
        outcome: {
          outcome: 'available',
          data: { bars: [bar('2026-11-20T20:45:00.000Z', 8), bar('2026-11-23T14:30:00.000Z', 9)] },
        },
      },
    ],
  } as unknown as GetSeriesResponse
  const map = sparklineClosesByListing(response)
  assert.deepEqual(map.get('overnight'), [2, 3, 4, 5, 6, 7])
  assert.deepEqual(map.get('weekend'), [9])
})
