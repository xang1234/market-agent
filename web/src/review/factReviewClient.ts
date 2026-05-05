import type {
  FactReviewCandidate,
  FactReviewQueueAction,
  FactReviewQueueItem,
  FactReviewQueueRejectAction,
} from './FactReviewQueue.tsx'

export const FACT_REVIEW_API_BASE = '/v1/evidence/fact-review-queue'

export class FactReviewFetchError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'FactReviewFetchError'
    this.status = status
  }
}

export type FetchFactReviewQueueArgs = {
  reviewerId: string
  staleAfterSeconds?: number
  fetchImpl?: typeof fetch
}

export async function fetchFactReviewQueue({
  reviewerId,
  staleAfterSeconds,
  fetchImpl = fetch,
}: FetchFactReviewQueueArgs): Promise<ReadonlyArray<FactReviewQueueItem>> {
  const endpoint = new URL(FACT_REVIEW_API_BASE, 'http://localhost')
  if (staleAfterSeconds != null) endpoint.searchParams.set('stale_after_seconds', String(staleAfterSeconds))
  const response = await fetchImpl(`${endpoint.pathname}${endpoint.search}`, {
    headers: { 'x-user-id': reviewerId },
  })
  const body = await readJson(response)
  if (!response.ok) throw new FactReviewFetchError(response.status, errorMessage(body, response.status))
  const items = (body as { items?: unknown }).items
  if (!Array.isArray(items)) throw new FactReviewFetchError(response.status, 'Malformed fact review queue response')
  return items as FactReviewQueueItem[]
}

export async function approveFactReview(
  reviewerId: string,
  action: FactReviewQueueAction,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await submitReviewAction(reviewerId, action.review_id, 'approve', 'POST', {
    candidate: action.candidate,
    notes: action.notes,
  }, fetchImpl)
}

export async function editFactReviewCandidate(
  reviewerId: string,
  action: FactReviewQueueAction,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await submitReviewAction(reviewerId, action.review_id, 'candidate', 'PATCH', {
    candidate: action.candidate,
    notes: action.notes,
  }, fetchImpl)
}

export async function rejectFactReview(
  reviewerId: string,
  action: FactReviewQueueRejectAction,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await submitReviewAction(reviewerId, action.review_id, 'reject', 'POST', {
    notes: action.notes,
  }, fetchImpl)
}

async function submitReviewAction(
  reviewerId: string,
  reviewId: string,
  actionPath: 'approve' | 'reject' | 'candidate',
  method: 'POST' | 'PATCH',
  body: { candidate?: FactReviewCandidate; notes: string | null },
  fetchImpl: typeof fetch,
): Promise<void> {
  const response = await fetchImpl(`${FACT_REVIEW_API_BASE}/${encodeURIComponent(reviewId)}/${actionPath}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-user-id': reviewerId,
    },
    body: JSON.stringify(body),
  })
  const parsed = await readJson(response)
  if (!response.ok) throw new FactReviewFetchError(response.status, errorMessage(parsed, response.status))
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body !== null && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error
  }
  return `HTTP ${status}`
}
