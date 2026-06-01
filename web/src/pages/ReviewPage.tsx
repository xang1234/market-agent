import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { FactReviewQueue, type FactReviewQueueAction, type FactReviewQueueItem, type FactReviewQueueRejectAction } from '../review/FactReviewQueue.tsx'
import {
  approveFactReview,
  editFactReviewCandidate,
  fetchFactReviewQueue,
  rejectFactReview,
} from '../review/factReviewClient.ts'
import { isStaleItem, severityForItem, tallySeverities } from '../review/severity.ts'
import { SeverityBadge } from '../blocks/SeverityBadge.tsx'
import { useAuth } from '../shell/useAuth.ts'
import { useRightRailContent } from '../shell/useRightRailContent.ts'

type ReviewLoadState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: ReadonlyArray<FactReviewQueueItem> }

export function ReviewPage() {
  const { session } = useAuth()
  const reviewerId = session?.userId ?? null
  const [state, setState] = useState<ReviewLoadState>({ kind: 'loading' })
  // Transient feedback for bulk actions (which don't go through the queue's
  // per-item error channel). Cleared on the next successful bulk run.
  const [notice, setNotice] = useState<string | null>(null)
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

  // Bulk-approve every low-severity candidate as-is, then refresh once. Done in
  // the page (not the queue component, which remounts on every approval) so the
  // loop survives to completion against a stable owner. A failure stops the
  // batch and surfaces a notice; the finally-refresh reconciles with the server
  // so the queue reflects whatever did get approved rather than a stale view.
  const approveAllLow = useCallback(async () => {
    if (reviewerId === null || state.kind !== 'ready') return
    const lows = state.items.filter((item) => severityForItem(item) === 'low')
    try {
      for (const item of lows) {
        await approveFactReview(reviewerId, {
          review_id: item.review_id,
          candidate: item.candidate,
          notes: null,
        })
      }
      setNotice(null)
    } catch (error) {
      setNotice(`Bulk approve stopped: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await refresh()
    }
  }, [refresh, reviewerId, state])

  const visibleState: ReviewLoadState = reviewerId === null ? { kind: 'unauthenticated' } : state

  // Push queue-health context into the shell-owned right rail; cleared when
  // unauthenticated or on unmount.
  const railItems = visibleState.kind === 'ready' ? visibleState.items : null
  useRightRailContent(railItems ? <ReviewRail items={railItems} /> : null, [railItems])

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
      <header>
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="mt-1 text-sm text-muted">
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
        <>
          {notice ? (
            <p role="status" className="text-sm text-negative">
              {notice}
            </p>
          ) : null}
          <FactReviewQueue
            items={visibleState.items}
            onApprove={approve}
            onEdit={edit}
            onReject={reject}
            onApproveAllLow={approveAllLow}
          />
        </>
      )}
    </div>
  )
}

function ReviewRail({ items }: { items: ReadonlyArray<FactReviewQueueItem> }) {
  const counts = tallySeverities(items)
  const stale = items.filter(isStaleItem).length
  return (
    <div className="flex flex-col gap-4 p-4">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Queue health</h2>
        <dl className="mt-2 flex flex-col gap-2 text-sm">
          <RailRow label="Awaiting">
            <span className="num text-fg">{items.length}</span>
          </RailRow>
          <RailRow label="High severity">
            <SeverityBadge severity="high">{counts.high}</SeverityBadge>
          </RailRow>
          <RailRow label="Medium severity">
            <SeverityBadge severity="medium">{counts.medium}</SeverityBadge>
          </RailRow>
          <RailRow label="Low severity">
            <SeverityBadge severity="low">{counts.low}</SeverityBadge>
          </RailRow>
          <RailRow label="Stale">
            <span className={`num ${stale > 0 ? 'text-warning' : 'text-muted'}`}>{stale}</span>
          </RailRow>
        </dl>
      </section>
    </div>
  )
}

function RailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
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
    tone === 'error' ? 'text-negative' : 'text-muted'
  return (
    <section className="rounded-md border border-line bg-surface p-6">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <p className={`mt-2 text-sm ${messageClass}`}>{message}</p>
    </section>
  )
}
