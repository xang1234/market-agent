import { QuoteRow } from '../symbol/QuoteRow'
import type { SubjectRef, WatchlistMember } from './membership'
import type { ManualWatchlistStatus } from './useManualWatchlist'

type ManualWatchlistProps = {
  members: WatchlistMember[]
  status: ManualWatchlistStatus
  message: string | null
  onRemove: (subjectRef: SubjectRef) => void
}

// Each row hydrates its own quote through the shared QuoteRow component
// (cw0.10.1) so watchlist members and held holdings render identically
// for the same subject. Members whose subject_ref is not listing-kind
// surface a quote-unavailable state — the rule from fra-6al.6.2.
export function ManualWatchlist({ members, status, message, onRemove }: ManualWatchlistProps) {
  if (status === 'loading' && members.length === 0) {
    return (
      <div className="px-1.5 py-3 text-xs text-muted">Loading watchlist…</div>
    )
  }

  if (members.length === 0) {
    return (
      <div className="px-1.5 py-3 text-xs text-muted">
        {message ?? 'No saved symbols yet. Add one from the search above.'}
      </div>
    )
  }

  return (
    <ul aria-label="Watchlist members" className="flex flex-col">
      {members.map((member) => (
        <QuoteRow
          key={`${member.subject_ref.kind}:${member.subject_ref.id}`}
          subjectRef={member.subject_ref}
          trailing={
            <button
              type="button"
              onClick={() => onRemove(member.subject_ref)}
              aria-label={`Remove ${member.subject_ref.kind} from watchlist`}
              className="shrink-0 px-2 text-xs text-faint hover:text-negative"
            >
              ×
            </button>
          }
        />
      ))}
      {message ? (
        <li className="px-1.5 py-2 text-[11px] text-negative">{message}</li>
      ) : null}
    </ul>
  )
}
