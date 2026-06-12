import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dailySeriesQuery,
  fetchSeries,
  rangeDays,
  windowedDailyQuery,
  SeriesFetchError,
  singleListingOutcome,
  type GetSeriesResponse,
  type NormalizedSeriesQuery,
} from './series.ts'

const APPLE_LISTING_ID = '11111111-1111-4111-a111-111111111111'
const MSFT_LISTING_ID = '22222222-2222-4222-a222-222222222222'
const POLYGON_SOURCE_ID = '00000000-0000-4000-a000-000000000001'

const FIXED_END = '2026-04-26T15:30:00.000Z'

test('windowedDailyQuery binds all five dimensions of the spec series query', () => {
  const q = windowedDailyQuery(APPLE_LISTING_ID, 30, FIXED_END)
  assert.deepEqual(q.subject_refs, [{ kind: 'listing', id: APPLE_LISTING_ID }])
  assert.equal(q.interval, '1d')
  assert.equal(q.basis, 'split_and_div_adjusted')
  assert.equal(q.normalization, 'raw')
  assert.equal(q.range.end, FIXED_END)
})

test('windowedDailyQuery sizes the range span from the day window', () => {
  for (const days of [30, 180, 365]) {
    const q = windowedDailyQuery(APPLE_LISTING_ID, days, FIXED_END)
    const span = Date.parse(q.range.end) - Date.parse(q.range.start)
    assert.equal(span, days * 24 * 60 * 60 * 1000, `span for ${days}d`)
  }
})

test('fetchSeries POSTs JSON, sends the binding query, and returns the GetSeriesResponse verbatim', async () => {
  const query = windowedDailyQuery(APPLE_LISTING_ID, 30, FIXED_END)
  const wireResponse: GetSeriesResponse = {
    query,
    results: [
      {
        listing: { kind: 'listing', id: APPLE_LISTING_ID },
        outcome: {
          outcome: 'available',
          data: {
            listing: { kind: 'listing', id: APPLE_LISTING_ID },
            interval: '1d',
            range: query.range,
            bars: [
              { ts: '2026-04-25T00:00:00.000Z', open: 1, high: 2, low: 1, close: 1.5, volume: 1000 },
            ],
            as_of: FIXED_END,
            delay_class: 'delayed_15m',
            currency: 'USD',
            source_id: POLYGON_SOURCE_ID,
            adjustment_basis: 'split_and_div_adjusted',
          },
        },
      },
    ],
  }

  let capturedInit: RequestInit | undefined
  let capturedUrl = ''
  const fetchImpl: typeof fetch = async (input, init) => {
    capturedUrl = input.toString()
    capturedInit = init
    return new Response(JSON.stringify(wireResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const out = await fetchSeries(query, { fetchImpl })
  assert.equal(out.results.length, 1)
  assert.equal(capturedUrl, '/v1/market/series')
  assert.equal(capturedInit?.method, 'POST')
  assert.deepEqual(JSON.parse((capturedInit?.body as string) ?? ''), query)
})

test('fetchSeries throws SeriesFetchError on non-2xx with the status code', async () => {
  const query: NormalizedSeriesQuery = windowedDailyQuery(APPLE_LISTING_ID, 30, FIXED_END)
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ error: 'boom' }), { status: 400 })
  await assert.rejects(
    () => fetchSeries(query, { fetchImpl }),
    (err: unknown) => err instanceof SeriesFetchError && err.status === 400,
  )
})

test('singleListingOutcome returns the matching per-listing outcome', () => {
  const query = windowedDailyQuery(APPLE_LISTING_ID, 30, FIXED_END)
  const response: GetSeriesResponse = {
    query,
    results: [
      {
        listing: { kind: 'listing', id: APPLE_LISTING_ID },
        outcome: {
          outcome: 'unavailable',
          reason: 'missing_coverage',
          listing: { kind: 'listing', id: APPLE_LISTING_ID },
          source_id: POLYGON_SOURCE_ID,
          as_of: FIXED_END,
          retryable: false,
          detail: 'listing not found',
        },
      },
    ],
  }
  const outcome = singleListingOutcome(response, APPLE_LISTING_ID)
  assert.ok(outcome)
  assert.equal(outcome!.outcome, 'unavailable')
})

test('singleListingOutcome returns null when the listing is not in the response', () => {
  const query: NormalizedSeriesQuery = windowedDailyQuery(MSFT_LISTING_ID, 30, FIXED_END)
  const response: GetSeriesResponse = { query, results: [] }
  assert.equal(singleListingOutcome(response, APPLE_LISTING_ID), null)
})

test('rangeDays resolves YTD from the anchor and fixed labels from the table', () => {
  assert.equal(rangeDays('YTD', new Date('2026-06-12T00:00:00Z')), 162)
  // Early-January YTD keeps the min-7 guard so a line is still drawable.
  assert.equal(rangeDays('YTD', new Date('2026-01-02T12:00:00Z')), 7)
  assert.equal(rangeDays('5D', new Date()), 7)
  assert.equal(rangeDays('3M', new Date()), 90)
  assert.equal(rangeDays('5Y', new Date()), 1825)
  assert.equal(rangeDays('bogus', new Date()), null)
})

test('dailySeriesQuery anchors the range end and binds the daily-bars contract', () => {
  const anchor = new Date('2026-06-12T00:00:00Z')
  const query = dailySeriesQuery(
    [{ kind: 'listing', id: APPLE_LISTING_ID }],
    '1M',
    'pct_return',
    anchor,
  )
  assert.ok(query !== null)
  assert.equal(query.range.end, '2026-06-12T00:00:00.000Z')
  assert.equal(query.interval, '1d')
  assert.equal(query.basis, 'split_and_div_adjusted')
  assert.equal(query.normalization, 'pct_return')
  assert.equal(
    (Date.parse(query.range.end) - Date.parse(query.range.start)) / (24 * 60 * 60 * 1000),
    30,
  )
})

test('dailySeriesQuery returns null for unknown labels or empty listings', () => {
  assert.equal(dailySeriesQuery([{ kind: 'listing', id: APPLE_LISTING_ID }], 'bogus', 'raw', new Date()), null)
  assert.equal(dailySeriesQuery([], '1M', 'raw', new Date()), null)
})
