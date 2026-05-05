import assert from 'node:assert/strict'
import test from 'node:test'

import {
  approveFactReview,
  FactReviewFetchError,
  fetchFactReviewQueue,
  rejectFactReview,
} from './factReviewClient.ts'

const REVIEW_ID = '66666666-6666-4666-8666-666666666666'
const REVIEWER_ID = '00000000-0000-4000-8000-000000000001'

test('fetchFactReviewQueue requests stale queue items with reviewer identity', async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ input, init })
    return jsonResponse(200, { items: [{ review_id: REVIEW_ID, candidate: {}, reason: 'x' }] })
  }

  const items = await fetchFactReviewQueue({
    reviewerId: REVIEWER_ID,
    staleAfterSeconds: 3600,
    fetchImpl,
  })

  assert.equal(items[0].review_id, REVIEW_ID)
  assert.equal(requests[0].input, '/v1/evidence/fact-review-queue?stale_after_seconds=3600')
  assert.deepEqual(requests[0].init?.headers, { 'x-user-id': REVIEWER_ID })
})

test('fetchFactReviewQueue requests all queued items by default', async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ input, init })
    return jsonResponse(200, { items: [] })
  }

  await fetchFactReviewQueue({ reviewerId: REVIEWER_ID, fetchImpl })

  assert.equal(requests[0].input, '/v1/evidence/fact-review-queue')
  assert.deepEqual(requests[0].init?.headers, { 'x-user-id': REVIEWER_ID })
})

test('approveFactReview POSTs candidate edits and notes', async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ input, init })
    return jsonResponse(200, { ok: true })
  }

  await approveFactReview(
    REVIEWER_ID,
    {
      review_id: REVIEW_ID,
      candidate: { value_num: 101.25 },
      notes: 'verified',
    },
    fetchImpl,
  )

  assert.equal(requests[0].input, `/v1/evidence/fact-review-queue/${REVIEW_ID}/approve`)
  assert.equal(requests[0].init?.method, 'POST')
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    candidate: { value_num: 101.25 },
    notes: 'verified',
  })
})

test('rejectFactReview throws structured fetch errors', async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse(500, { error: 'nope' })

  await assert.rejects(
    () => rejectFactReview(REVIEWER_ID, { review_id: REVIEW_ID, notes: null }, fetchImpl),
    (error) => error instanceof FactReviewFetchError && error.status === 500 && error.message === 'nope',
  )
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
