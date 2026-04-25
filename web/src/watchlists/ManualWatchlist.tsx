import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchQuoteSnapshot,
  formatQuotePrice,
  formatSignedPercent,
  quoteDirection,
  type QuoteSnapshot,
} from '../symbol/quote'
import { symbolDetailPathForSubject } from '../symbol/search'
import type { SubjectRef, WatchlistMember } from './membership'
import type { ManualWatchlistStatus } from './useManualWatchlist'

type ManualWatchlistProps = {
  members: WatchlistMember[]
  status: ManualWatchlistStatus
  message: string | null
  onRemove: (subjectRef: SubjectRef) => void
}

// Each row hydrates its quote independently from the market service. Members
// whose subject_ref is not listing-kind (e.g. an issuer added before listing
// hydration lands) render a quote-unavailable state — surfacing the absent
// context honestly is the rule established in fra-6al.6.2 and preserved here
// now that the stub is gone.
export function ManualWatchlist({ members, status, message, onRemove }: ManualWatchlistProps) {
  if (status === 'loading' && members.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Loading watchlist…
      </div>
    )
  }

  if (members.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
        {message ?? 'No saved symbols yet. Add one from the search above.'}
      </div>
    )
  }

  return (
    <ul aria-label="Watchlist members" className="divide-y divide-neutral-200 dark:divide-neutral-800">
      {members.map((member) => (
        <WatchlistRow
          key={`${member.subject_ref.kind}:${member.subject_ref.id}`}
          member={member}
          onRemove={onRemove}
        />
      ))}
      {message ? (
        <li className="px-3 py-2 text-[11px] text-red-600 dark:text-red-400">{message}</li>
      ) : null}
    </ul>
  )
}

type RowState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; quote: QuoteSnapshot }

function WatchlistRow({
  member,
  onRemove,
}: {
  member: WatchlistMember
  onRemove: (subjectRef: SubjectRef) => void
}) {
  const listingId = member.subject_ref.kind === 'listing' ? member.subject_ref.id : null
  const [state, setState] = useState<RowState>(
    listingId ? { status: 'loading' } : { status: 'unavailable' },
  )

  useEffect(() => {
    if (!listingId) {
      setState({ status: 'unavailable' })
      return
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetchQuoteSnapshot(listingId, { signal: controller.signal })
      .then((quote) => {
        if (controller.signal.aborted) return
        setState({ status: 'ready', quote })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        console.warn('watchlist row quote fetch failed', err)
        setState({ status: 'unavailable' })
      })
    return () => controller.abort()
  }, [listingId])

  return (
    <li className="flex items-stretch">
      <Link
        to={symbolDetailPathForSubject(member.subject_ref)}
        title={state.status === 'ready' ? freshnessLabel(state.quote) : undefined}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-neutral-800 dark:text-neutral-100">
            {primaryLabel(state, member.subject_ref)}
          </span>
          <span className="block truncate text-[10px] text-neutral-500 dark:text-neutral-400">
            {secondaryLabel(state, member.subject_ref)}
          </span>
        </span>
        <span className="shrink-0 text-right">
          {state.status === 'ready' ? (
            <>
              <span className="block tabular-nums font-medium text-neutral-900 dark:text-neutral-50">
                {formatQuotePrice(state.quote.latest_price, state.quote.currency)}
              </span>
              <span className={`block text-[10px] tabular-nums ${moveClassName(state.quote)}`}>
                {formatSignedPercent(state.quote.percent_move)}
              </span>
            </>
          ) : (
            <span className="block text-[10px] text-neutral-400 dark:text-neutral-500">—</span>
          )}
        </span>
      </Link>
      <button
        type="button"
        onClick={() => onRemove(member.subject_ref)}
        aria-label={`Remove ${member.subject_ref.kind} from watchlist`}
        className="shrink-0 px-2 text-xs text-neutral-400 hover:text-red-600 dark:text-neutral-500 dark:hover:text-red-400"
      >
        ×
      </button>
    </li>
  )
}

function moveClassName(quote: QuoteSnapshot): string {
  const direction = quoteDirection(quote)
  if (direction === 'up') return 'text-emerald-700 dark:text-emerald-400'
  if (direction === 'down') return 'text-red-700 dark:text-red-400'
  return 'text-neutral-500 dark:text-neutral-400'
}

function primaryLabel(state: RowState, ref: SubjectRef): string {
  if (state.status === 'ready') return state.quote.listing.ticker
  return truncateId(ref.id)
}

function secondaryLabel(state: RowState, ref: SubjectRef): string {
  if (state.status === 'ready') {
    return `${state.quote.listing.mic} · ${state.quote.currency}`
  }
  return ref.kind
}

function freshnessLabel(quote: QuoteSnapshot): string {
  return `${quote.session_state.replaceAll('_', ' ')} · ${quote.delay_class.replaceAll('_', ' ')} · ${quote.as_of}`
}

function truncateId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`
}
