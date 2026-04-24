import { Link } from 'react-router-dom'
import {
  formatQuotePrice,
  formatSignedPercent,
  quoteDirection,
  quoteFromSubjectRef,
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

// fra-6al.6.2: each row reuses the P0.4 listing-oriented quote snapshot —
// quoteFromSubjectRef feeds the same createQuoteSnapshotStub that subject
// detail uses, so row and landing agree on price / move / freshness for the
// same subject. Richer listing context (real ticker / MIC) will arrive when
// a SubjectRef hydration endpoint lands; until then the stub's N/A fallback
// is honest about the absent context instead of inventing one.
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

function WatchlistRow({
  member,
  onRemove,
}: {
  member: WatchlistMember
  onRemove: (subjectRef: SubjectRef) => void
}) {
  const quote = quoteFromSubjectRef(member.subject_ref)
  const direction = quoteDirection(quote)
  const moveClassName =
    direction === 'up'
      ? 'text-emerald-700 dark:text-emerald-400'
      : direction === 'down'
        ? 'text-red-700 dark:text-red-400'
        : 'text-neutral-500 dark:text-neutral-400'

  return (
    <li className="flex items-stretch">
      <Link
        to={symbolDetailPathForSubject(member.subject_ref)}
        title={freshnessLabel(quote)}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-neutral-800 dark:text-neutral-100">
            {primaryLabel(quote, member.subject_ref)}
          </span>
          <span className="block truncate text-[10px] text-neutral-500 dark:text-neutral-400">
            {secondaryLabel(quote, member.subject_ref)}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block tabular-nums font-medium text-neutral-900 dark:text-neutral-50">
            {formatQuotePrice(quote.latest_price, quote.currency)}
          </span>
          <span className={`block text-[10px] tabular-nums ${moveClassName}`}>
            {formatSignedPercent(quote.percent_move)}
          </span>
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

function primaryLabel(quote: QuoteSnapshot, ref: SubjectRef): string {
  if (quote.listing.ticker && quote.listing.ticker !== 'N/A') return quote.listing.ticker
  return `${ref.kind}:${truncateId(ref.id)}`
}

function secondaryLabel(quote: QuoteSnapshot, ref: SubjectRef): string {
  const mic = quote.listing.mic
  if (mic && mic !== 'UNKNOWN') return `${mic} · ${quote.currency}`
  return truncateId(ref.id)
}

function freshnessLabel(quote: QuoteSnapshot): string {
  return `${quote.session_state.replaceAll('_', ' ')} · ${quote.delay_class} · ${quote.as_of}`
}

function truncateId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`
}
