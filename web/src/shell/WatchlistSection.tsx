// Watchlist group inside the left sidebar (redesign IA — replaces the prior
// standalone WatchlistSlot aside). Keeps the default-manual membership list
// (fra-6al.6.1) and the inline add-symbol search. WatchlistSaveHandler, mounted
// by the shell, completes save-to-watchlist actions (fra-6al.6.3).
import { useAuth } from './useAuth'
import { SymbolSearch } from '../symbol/SymbolSearch'
import { ManualWatchlist } from '../watchlists/ManualWatchlist'
import { useWatchlist } from '../watchlists/watchlistContext'
import { useWatchlistSparklines } from '../watchlists/useWatchlistSparklines'

export function WatchlistSection() {
  const { session } = useAuth()
  const userId = session?.userId ?? null
  const watchlist = useWatchlist()
  const sparklines = useWatchlistSparklines(watchlist.members.map((member) => member.subject_ref))

  return (
    <section aria-label="Watchlist" className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-faint">
        Watchlists
      </div>
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {userId ? (
          <ManualWatchlist
            members={watchlist.members}
            load={watchlist.load}
            editError={watchlist.editError}
            onRemove={(ref) => void watchlist.removeSubject(ref)}
            onRetry={watchlist.reload}
            sparklines={sparklines}
          />
        ) : (
          <div className="px-1.5 py-3 text-xs text-muted">Sign in to view your watchlist.</div>
        )}
      </div>
    </section>
  )
}
