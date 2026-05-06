import { useCallback, useEffect, useRef, useState } from 'react'

import { FactReviewQueue, type FactReviewQueueAction, type FactReviewQueueItem, type FactReviewQueueRejectAction } from '../review/FactReviewQueue.tsx'
import {
  approveFactReview,
  editFactReviewCandidate,
  fetchFactReviewQueue,
  rejectFactReview,
} from '../review/factReviewClient.ts'
import { useAuth } from '../shell/useAuth.ts'

type ReviewLoadState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: ReadonlyArray<FactReviewQueueItem> }

export function ReviewPage() {
  const { session } = useAuth()
  const reviewerId = session?.userId ?? null
  const [state, setState] = useState<ReviewLoadState>({ kind: 'loading' })
  const refreshTokenRef = useRef(0)

  const refresh = useCallback(async () => {
    const token = refreshTokenRef.current + 1
    refreshTokenRef.current = token
    if (reviewerId === null) return
    try {
      const nextState = await fetchReviewLoadState(reviewerId)
      if (token !== refreshTokenRef.current) return
      setState(nextState)
    } catch (error) {
      if (token !== refreshTokenRef.current) return
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [reviewerId])

  useEffect(() => {
    if (reviewerId === null) {
      refreshTokenRef.current += 1
      return
    }
    const token = refreshTokenRef.current + 1
    refreshTokenRef.current = token
    fetchReviewLoadState(reviewerId)
      .then((nextState) => {
        if (token === refreshTokenRef.current) setState(nextState)
      })
      .catch((error: unknown) => {
        if (token === refreshTokenRef.current) {
          setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      })
    return () => {
      refreshTokenRef.current += 1
    }
  }, [reviewerId])

  const approve = useCallback(
    async (action: FactReviewQueueAction) => {
      if (reviewerId === null) return
      await approveFactReview(reviewerId, action)
      await refresh()
    },
    [refresh, reviewerId],
  )
  const edit = useCallback(
    async (action: FactReviewQueueAction) => {
      if (reviewerId === null) return
      await editFactReviewCandidate(reviewerId, action)
      await refresh()
    },
    [refresh, reviewerId],
  )
  const reject = useCallback(
    async (action: FactReviewQueueRejectAction) => {
      if (reviewerId === null) return
      await rejectFactReview(reviewerId, action)
      await refresh()
    },
    [refresh, reviewerId],
  )

  const visibleState: ReviewLoadState = reviewerId === null ? { kind: 'unauthenticated' } : state

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
      <header>
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Candidate fact queue for human approval, correction, and dismissal.
        </p>
      </header>
      {visibleState.kind === 'loading' ? (
        <ReviewStatus title="Loading reviewer queue" message="Fetching candidate facts." />
      ) : visibleState.kind === 'unauthenticated' ? (
        <ReviewStatus title="Reviewer sign-in required" message="Sign in to review candidate facts." />
      ) : visibleState.kind === 'error' ? (
        <ReviewStatus title="Review queue unavailable" message={visibleState.message} tone="error" />
      ) : (
        <FactReviewQueue items={visibleState.items} onApprove={approve} onEdit={edit} onReject={reject} />
      )}
    </div>
  )
}

async function fetchReviewLoadState(reviewerId: string): Promise<ReviewLoadState> {
  const items = await fetchFactReviewQueue({ reviewerId })
  return { kind: 'ready', items }
}

function ReviewStatus({
  title,
  message,
  tone = 'neutral',
}: {
  title: string
  message: string
  tone?: 'neutral' | 'error'
}) {
  const messageClass =
    tone === 'error' ? 'text-rose-600 dark:text-rose-300' : 'text-neutral-500 dark:text-neutral-400'
  return (
    <section className="rounded-md border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <p className={`mt-2 text-sm ${messageClass}`}>{message}</p>
    </section>
  )
}
