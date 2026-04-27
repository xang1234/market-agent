// Shared quote-row skeleton. Both watchlist members and portfolio holdings
// route through this component so the same subject renders identically on
// either surface. Hydration goes through `useFetched`; presentation comes
// from the pure `quoteRowView` projection in quoteRowView.ts.

import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { fetchQuoteSnapshot, quoteBelongsToListing, type QuoteDirection } from './quote.ts'
import { quoteRowView } from './quoteRowView.ts'
import type { SubjectRef } from './search.ts'
import { NEGATIVE_CLASS, NEUTRAL_CLASS, POSITIVE_CLASS } from './signedColor.ts'
import { useFetched, type FetchedResult } from './useFetched.ts'

type QuoteRowProps = {
  subjectRef: SubjectRef
  trailing?: ReactNode
}

export function QuoteRow({ subjectRef, trailing }: QuoteRowProps) {
  const listingId = subjectRef.kind === 'listing' ? subjectRef.id : null
  const state = useFetched(listingId, fetchQuoteForListing)
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
              <span className={`block text-[10px] tabular-nums ${DIRECTION_CLASS[view.price.direction]}`}>
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

const DIRECTION_CLASS: Readonly<Record<QuoteDirection, string>> = {
  up: POSITIVE_CLASS,
  down: NEGATIVE_CLASS,
  flat: NEUTRAL_CLASS,
}

async function fetchQuoteForListing(
  listingId: string,
  signal: AbortSignal,
): Promise<FetchedResult<Awaited<ReturnType<typeof fetchQuoteSnapshot>>>> {
  const quote = await fetchQuoteSnapshot(listingId, { signal })
  if (!quoteBelongsToListing(quote, listingId)) {
    return { kind: 'unavailable', reason: 'listing mismatch' }
  }
  return { kind: 'ready', data: quote }
}
