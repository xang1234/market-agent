// Shared quote-row skeleton. Both watchlist members and portfolio holdings
// route through this component so the same subject renders identically on
// either surface. Hydration goes through `useFetched`; presentation comes
// from the pure `quoteRowView` projection in quoteRowView.ts.

import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChangePill } from './ChangePill.tsx'
import { fetchQuoteSnapshot, quoteBelongsToListing, SIGNED_BY_QUOTE_DIRECTION } from './quote.ts'
import { quoteRowView } from './quoteRowView.ts'
import type { SubjectRef } from './search.ts'
import { Sparkline } from './Sparkline.tsx'
import { useFetched, type FetchedResult } from './useFetched.ts'

type QuoteRowProps = {
  subjectRef: SubjectRef
  trailing?: ReactNode
  // Closing prices for an inline trend sparkline (reference-terminal rail).
  // Omit to render the row without one (e.g. holdings surfaces).
  sparkline?: ReadonlyArray<number>
}

export function QuoteRow({ subjectRef, trailing, sparkline }: QuoteRowProps) {
  const listingId = subjectRef.kind === 'listing' ? subjectRef.id : null
  const state = useFetched(listingId, fetchQuoteForListing)
  const view = quoteRowView(state, subjectRef)

  return (
    <li className="flex items-stretch">
      <Link
        to={view.href}
        title={view.price?.freshness}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-xs hover:bg-surface-hover"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-fg">{view.primary}</span>
          <span className="block truncate text-[10px] text-muted">{view.secondary}</span>
        </span>
        {sparkline !== undefined && sparkline.length >= 2 ? (
          <Sparkline
            values={sparkline}
            ariaLabel="price trend"
            trendStrokeClass={
              sparkline[sparkline.length - 1] >= sparkline[0]
                ? 'stroke-positive'
                : 'stroke-negative'
            }
            className="h-6 w-14 shrink-0"
          />
        ) : null}
        <span className="flex shrink-0 flex-col items-end gap-1">
          {view.price ? (
            <>
              <span className="num block font-medium text-fg">{view.price.text}</span>
              <ChangePill
                direction={SIGNED_BY_QUOTE_DIRECTION[view.price.direction]}
                withArrow={false}
              >
                {view.price.percent}
              </ChangePill>
            </>
          ) : (
            <span className="block text-[10px] text-faint">—</span>
          )}
        </span>
      </Link>
      {trailing}
    </li>
  )
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
