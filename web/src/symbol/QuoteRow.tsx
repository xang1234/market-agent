// Shared quote-row skeleton. Both watchlist members and portfolio holdings
// route through this component so the same subject renders identically on
// either surface.

import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChangePill } from './ChangePill.tsx'
import { useResource } from '../fetch/resource.ts'
import { listingQuote, SIGNED_BY_QUOTE_DIRECTION, type QuoteDirection } from './quote.ts'
import { quoteRowView } from './quoteRowView.ts'
import { subjectHydration, type SubjectRef } from './search.ts'
import { Sparkline } from './Sparkline.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'

const SPARKLINE_STROKE: Readonly<Record<QuoteDirection, string>> = {
  up: 'stroke-positive',
  down: 'stroke-negative',
  flat: 'stroke-muted',
}

type QuoteRowProps = {
  subjectRef: SubjectRef
  // Given the row's label, so a control beside the row can say what it acts on.
  trailing?: (label: string | null) => ReactNode
  // Closing prices of the latest session for an inline sparkline (watchlist
  // rail). Coloured by the quote's day change, so it matches the pill.
  // Omit to render the row without one (e.g. holdings surfaces).
  sparkline?: ReadonlyArray<number>
}

export function QuoteRow({ subjectRef, trailing, sparkline }: QuoteRowProps) {
  const listingId = subjectRef.kind === 'listing' ? subjectRef.id : null
  const state = useResource(listingQuote, listingId)
  const subject = useResource(subjectHydration, state.status === 'idle' || state.status === 'unavailable' ? subjectRef : null)
  const view = quoteRowView(state, subjectRef, subject)

  return (
    <li className="flex items-stretch">
      <Link
        to={view.href}
        title={view.price?.freshness}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-xs hover:bg-surface-hover"
      >
        <span className="min-w-0 flex-1">
          {view.primary === null ? (
            <Skeleton className="h-4 w-12" />
          ) : (
            <span className="block truncate font-semibold text-fg">{view.primary}</span>
          )}
          <span className="block truncate text-[10px] text-muted">{view.secondary}</span>
        </span>
        {sparkline !== undefined && sparkline.length >= 2 ? (
          <Sparkline
            values={sparkline}
            ariaLabel="price trend"
            trendStrokeClass={
              SPARKLINE_STROKE[
                view.price?.direction ?? (sparkline[sparkline.length - 1] >= sparkline[0] ? 'up' : 'down')
              ]
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
      {trailing?.(view.label)}
    </li>
  )
}
