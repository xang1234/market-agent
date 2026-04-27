import assert from 'node:assert/strict'
import test from 'node:test'
import {
  earningsBelongToIssuer,
  EarningsFetchError,
  fetchEarnings,
  type EarningsEventsEnvelope,
} from './earnings.ts'

const APPLE_ISSUER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1'
const SOURCE_ID = '00000000-0000-4000-a000-000000000007'

const baseEnvelope: EarningsEventsEnvelope = {
  subject: { kind: 'issuer', id: APPLE_ISSUER_ID },
  family: 'earnings_events',
  currency: 'USD',
  as_of: '2024-11-01T20:30:00.000Z',
  events: [
    {
      release_date: '2024-10-31',
      period_end: '2024-09-28',
      fiscal_year: 2024,
      fiscal_period: 'Q4',
      eps_actual: 1.64,
      eps_estimate_at_release: 1.6,
      surprise_pct: 2.5,
      surprise_direction: 'beat',
      source_id: SOURCE_ID,
      as_of: '2024-10-31T20:30:00.000Z',
    },
  ],
}

test('fetchEarnings issues a GET against /v1/fundamentals/earnings and unwraps the envelope', async () => {
  let capturedUrl = ''
  const fetchImpl: typeof fetch = async (input) => {
    capturedUrl = input.toString()
    return new Response(JSON.stringify({ earnings: baseEnvelope }), { status: 200 })
  }
  const out = await fetchEarnings(APPLE_ISSUER_ID, { fetchImpl })
  assert.equal(out.subject.id, APPLE_ISSUER_ID)
  assert.equal(out.events.length, 1)
  assert.equal(out.events[0].surprise_direction, 'beat')
  assert.equal(
    capturedUrl,
    `/v1/fundamentals/earnings?subject_kind=issuer&subject_id=${APPLE_ISSUER_ID}`,
  )
})

test('fetchEarnings throws EarningsFetchError on non-2xx with the status code', async () => {
  const fetchImpl: typeof fetch = async () => new Response('{}', { status: 404 })
  await assert.rejects(
    () => fetchEarnings(APPLE_ISSUER_ID, { fetchImpl }),
    (err: unknown) => err instanceof EarningsFetchError && err.status === 404,
  )
})

test('earningsBelongToIssuer matches issuer id and rejects mismatches', () => {
  assert.equal(earningsBelongToIssuer(baseEnvelope, APPLE_ISSUER_ID), true)
  assert.equal(earningsBelongToIssuer(baseEnvelope, 'other-id'), false)
  assert.equal(earningsBelongToIssuer(baseEnvelope, null), false)
})
