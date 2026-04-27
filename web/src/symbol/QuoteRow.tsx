// Shared quote-row skeleton (cw0.10.1).
//
// Used by manual-watchlist members and portfolio-held holdings — both
// surfaces present the same subject the same way. The contract is
// "same subject renders identical values"; that identity is enforced
// by routing the per-row hydration + presentation through one
// component and one pure view function (`quoteRowView` in
// quoteRowView.ts). The pure projection lives in its own .ts module so
// the node:test harness can import it without a JSX loader.

import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchQuoteSnapshot,
  quoteBelongsToListing,
  type QuoteDirection,
} from './quote.ts'
import { quoteRowView, type QuoteRowFetchState } from './quoteRowView.ts'
import type { SubjectRef } from './search.ts'

type FetchImpl = typeof fetch

type QuoteRowProps = {
  subjectRef: SubjectRef
  trailing?: ReactNode
  fetchImpl?: FetchImpl
}

export function QuoteRow({ subjectRef, trailing, fetchImpl }: QuoteRowProps) {
  const listingId = subjectRef.kind === 'listing' ? subjectRef.id : null
  const [state, setState] = useState<QuoteRowFetchState>({ status: 'idle' })

  useEffect(() => {
    if (!listingId) return
    const controller = new AbortController()
    fetchQuoteSnapshot(listingId, { signal: controller.signal, fetchImpl })
      .then((quote) => {
        if (controller.signal.aborted) return
        if (!quoteBelongsToListing(quote, listingId)) {
          setState({ status: 'unavailable', listingId })
          return
        }
        setState({ status: 'ready', listingId, quote })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        console.warn('quote row fetch failed', err)
        setState({ status: 'unavailable', listingId })
      })
    return () => controller.abort()
  }, [listingId, fetchImpl])

  const view = quoteRowView(state, subjectRef)

  return (
    <li className="flex items-stretch">
      <Link
        to={view.href}
        title={view.price?.freshness}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-neutral-800 dark:text-neutral-100">
            {view.primary}
          </span>
          <span className="block truncate text-[10px] text-neutral-500 dark:text-neutral-400">
            {view.secondary}
          </span>
        </span>
        <span className="shrink-0 text-right">
          {view.price ? (
            <>
              <span className="block tabular-nums font-medium text-neutral-900 dark:text-neutral-50">
                {view.price.text}
              </span>
              <span className={`block text-[10px] tabular-nums ${moveClassName(view.price.direction)}`}>
                {view.price.percent}
              </span>
            </>
          ) : (
            <span className="block text-[10px] text-neutral-400 dark:text-neutral-500">—</span>
          )}
        </span>
      </Link>
      {trailing}
    </li>
  )
}

function moveClassName(direction: QuoteDirection): string {
  if (direction === 'up') return 'text-emerald-700 dark:text-emerald-400'
  if (direction === 'down') return 'text-red-700 dark:text-red-400'
  return 'text-neutral-500 dark:text-neutral-400'
}
