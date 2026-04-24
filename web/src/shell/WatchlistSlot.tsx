// Persistent left-rail watchlist slot (spec §3.7, IA refactor fra-4pz).
// fra-6al.6.1 ships the default-manual membership list; quote hydration
// per row (price / move / freshness) and the timeframe strip that scopes
// sparklines are still upcoming (fra-6al.6.2 and beyond). The timeframe
// chrome stays rendered but disabled so the slot's shape is visible.
import { useAuth } from './useAuth'
import { SymbolSearch } from '../symbol/SymbolSearch'
import { ManualWatchlist } from '../watchlists/ManualWatchlist'
import { useManualWatchlist } from '../watchlists/useManualWatchlist'

const TIMEFRAMES = ['1D', '5D', '1M', '3M', 'YTD', '1Y', '5Y'] as const

export function WatchlistSlot() {
  const { session } = useAuth()
  const userId = session?.userId ?? null
  const watchlist = useManualWatchlist(userId)

  return (
    <aside
      aria-label="Watchlist"
      className="flex h-full w-56 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Watchlist
          <span className="text-neutral-400 dark:text-neutral-500" aria-hidden="true">
            ▾
          </span>
        </div>
      </div>
      <div className="border-b border-neutral-200 px-2 py-2 dark:border-neutral-800">
        <SymbolSearch
          placement="watchlist"
          placeholder="Add symbol"
          onResolvedSubject={
            userId
              ? (subject) => {
                  void watchlist.addSubject(subject.subject_ref)
                }
              : undefined
          }
        />
      </div>
      <div className="flex items-center gap-0.5 border-b border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            type="button"
            disabled
            className="flex-1 rounded px-1 py-0.5 text-[10px] font-medium text-neutral-500 disabled:cursor-not-allowed dark:text-neutral-400"
          >
            {tf}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {userId ? (
          <ManualWatchlist
            members={watchlist.members}
            status={watchlist.status}
            message={watchlist.message}
            onRemove={(ref) => void watchlist.removeSubject(ref)}
          />
        ) : (
          <div className="p-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
            Sign in to view your watchlist.
          </div>
        )}
      </div>
    </aside>
  )
}
