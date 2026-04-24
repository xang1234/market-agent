import type { SubjectRef, WatchlistMember } from './membership'
import type { ManualWatchlistStatus } from './useManualWatchlist'

type ManualWatchlistProps = {
  members: WatchlistMember[]
  status: ManualWatchlistStatus
  message: string | null
  onRemove: (subjectRef: SubjectRef) => void
}

// Baseline render for the default manual watchlist (fra-6al.6.1). Rows show
// only the canonical SubjectRef; lightweight quote hydration (price / move /
// freshness) lands in fra-6al.6.2.
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
        <li
          key={`${member.subject_ref.kind}:${member.subject_ref.id}`}
          className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
        >
          <span className="min-w-0 truncate text-neutral-700 dark:text-neutral-200">
            <span className="font-medium">{member.subject_ref.kind}</span>{' '}
            <span className="text-neutral-500 dark:text-neutral-400">
              {truncateId(member.subject_ref.id)}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onRemove(member.subject_ref)}
            aria-label={`Remove ${member.subject_ref.kind} from watchlist`}
            className="shrink-0 rounded border border-transparent px-1 py-0.5 text-[10px] font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-100"
          >
            Remove
          </button>
        </li>
      ))}
      {message ? (
        <li className="px-3 py-2 text-[11px] text-red-600 dark:text-red-400">{message}</li>
      ) : null}
    </ul>
  )
}

function truncateId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`
}
