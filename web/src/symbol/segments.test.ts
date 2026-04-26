import assert from 'node:assert/strict'
import test from 'node:test'
import {
  axisLabel,
  fetchSegments,
  SegmentsFetchError,
  sumSegmentMetric,
  type GetSegmentsRequest,
  type SegmentFactsEnvelope,
} from './segments.ts'

const APPLE_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1'
const FIXTURE_SOURCE_ID = '00000000-0000-4000-a000-000000000006'
const REVENUE_METRIC_ID = '11111111-1111-4111-9111-111111111111'

const baseEnvelope: SegmentFactsEnvelope = {
  subject: { kind: 'issuer', id: APPLE_ISSUER_ID },
  family: 'segment_facts',
  axis: 'business',
  basis: 'as_reported',
  period_kind: 'fiscal_y',
  period_start: '2023-10-01',
  period_end: '2024-09-28',
  fiscal_year: 2024,
  fiscal_period: 'FY',
  reporting_currency: 'USD',
  as_of: '2024-11-01T20:30:00.000Z',
  segment_definitions: [
    { segment_id: 'iphone', segment_name: 'iPhone', definition_as_of: '2024-09-28' },
    { segment_id: 'mac', segment_name: 'Mac', definition_as_of: '2024-09-28' },
  ],
  facts: [
    {
      segment_id: 'iphone', metric_key: 'revenue', metric_id: REVENUE_METRIC_ID,
      value_num: 201_183_000_000, unit: 'currency', currency: 'USD', coverage_level: 'full',
      source_id: FIXTURE_SOURCE_ID, as_of: '2024-11-01T20:30:00.000Z',
    },
    {
      segment_id: 'mac', metric_key: 'revenue', metric_id: REVENUE_METRIC_ID,
      value_num: 29_984_000_000, unit: 'currency', currency: 'USD', coverage_level: 'full',
      source_id: FIXTURE_SOURCE_ID, as_of: '2024-11-01T20:30:00.000Z',
    },
  ],
  coverage_warnings: [],
}

function appleRequest(): GetSegmentsRequest {
  return {
    subject_ref: { kind: 'issuer', id: APPLE_ISSUER_ID },
    axis: 'business',
    period: '2024-FY',
    basis: 'as_reported',
  }
}

test('fetchSegments POSTs JSON, sends the binding query, and unwraps the wire envelope', async () => {
  const query = appleRequest()
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const fetchImpl: typeof fetch = async (input, init) => {
    capturedUrl = input.toString()
    capturedInit = init
    return new Response(JSON.stringify({ segments: baseEnvelope }), { status: 200 })
  }
  const out = await fetchSegments(query, { fetchImpl })
  assert.equal(out.axis, 'business')
  assert.equal(out.facts.length, 2)
  assert.equal(capturedUrl, '/v1/fundamentals/segments')
  assert.equal(capturedInit?.method, 'POST')
  assert.deepEqual(JSON.parse((capturedInit?.body as string) ?? ''), query)
})

test('fetchSegments throws SegmentsFetchError on non-2xx with the status code', async () => {
  const fetchImpl: typeof fetch = async () => new Response('{}', { status: 404 })
  await assert.rejects(
    () => fetchSegments(appleRequest(), { fetchImpl }),
    (err: unknown) => err instanceof SegmentsFetchError && err.status === 404,
  )
})

test('sumSegmentMetric sums only matching-key facts and skips null value_num', () => {
  assert.equal(sumSegmentMetric(baseEnvelope, 'revenue'), 231_167_000_000)
  // Sparse: a fact with null value_num doesn't pull the total down to zero
  // and doesn't add a fabricated 0 either.
  const sparse: SegmentFactsEnvelope = {
    ...baseEnvelope,
    facts: [
      ...baseEnvelope.facts,
      { ...baseEnvelope.facts[0], segment_id: 'ipad', value_num: null },
    ],
  }
  assert.equal(sumSegmentMetric(sparse, 'revenue'), 231_167_000_000)
  // Different metric: returns 0 when nothing matches.
  assert.equal(sumSegmentMetric(baseEnvelope, 'nonexistent'), 0)
})

test('axisLabel returns a human label for every known axis', () => {
  assert.equal(axisLabel('business'), 'Business')
  assert.equal(axisLabel('geography'), 'Geography')
})
