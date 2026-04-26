import assert from 'node:assert/strict'
import test from 'node:test'
import {
  consensusBelongsToIssuer,
  ConsensusFetchError,
  fetchConsensus,
  ratingLabel,
  type AnalystConsensusEnvelope,
} from './consensus.ts'

const APPLE_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1'
const SOURCE_ID = '00000000-0000-4000-a000-000000000005'

const baseEnvelope: AnalystConsensusEnvelope = {
  subject: { kind: 'issuer', id: APPLE_ISSUER_ID },
  family: 'analyst_consensus',
  analyst_count: 41,
  as_of: '2026-04-25T20:00:00.000Z',
  rating_distribution: {
    counts: { strong_buy: 14, buy: 17, hold: 8, sell: 1, strong_sell: 1 },
    contributor_count: 41,
    as_of: '2026-04-25T20:00:00.000Z',
    source_id: SOURCE_ID,
  },
  price_target: {
    currency: 'USD',
    low: 170,
    mean: 220.5,
    median: 215,
    high: 280,
    contributor_count: 38,
    as_of: '2026-04-25T20:00:00.000Z',
    source_id: SOURCE_ID,
  },
  estimates: [],
  coverage_warnings: [],
}

test('fetchConsensus issues a GET against /v1/fundamentals/consensus and unwraps the envelope', async () => {
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const fetchImpl: typeof fetch = async (input, init) => {
    capturedUrl = input.toString()
    capturedInit = init
    return new Response(JSON.stringify({ consensus: baseEnvelope }), { status: 200 })
  }
  const out = await fetchConsensus(APPLE_ISSUER_ID, { fetchImpl })
  assert.equal(out.subject.id, APPLE_ISSUER_ID)
  assert.equal(out.analyst_count, 41)
  assert.equal(
    capturedUrl,
    `/v1/fundamentals/consensus?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  )
  assert.equal(capturedInit?.method, undefined)
})

test('fetchConsensus throws ConsensusFetchError on non-2xx with the status code', async () => {
  const fetchImpl: typeof fetch = async () => new Response('{}', { status: 404 })
  await assert.rejects(
    () => fetchConsensus(APPLE_ISSUER_ID, { fetchImpl }),
    (err: unknown) => err instanceof ConsensusFetchError && err.status === 404,
  )
})

test('consensusBelongsToIssuer matches issuer id and rejects mismatches', () => {
  assert.equal(consensusBelongsToIssuer(baseEnvelope, APPLE_ISSUER_ID), true)
  assert.equal(consensusBelongsToIssuer(baseEnvelope, 'other-id'), false)
  assert.equal(consensusBelongsToIssuer(baseEnvelope, null), false)
})

test('ratingLabel returns a human label for every rating bucket', () => {
  assert.equal(ratingLabel('strong_buy'), 'Strong buy')
  assert.equal(ratingLabel('buy'), 'Buy')
  assert.equal(ratingLabel('hold'), 'Hold')
  assert.equal(ratingLabel('sell'), 'Sell')
  assert.equal(ratingLabel('strong_sell'), 'Strong sell')
})
