// Watchlist group inside the left sidebar (redesign IA — replaces the prior
// standalone WatchlistSlot aside). Keeps the default-manual membership list
// (fra-6al.6.1), the inline add-symbol search, and the save-to-watchlist
// resume handler (fra-6al.6.3) that completes an action dispatched by the
// inline auth interrupt from a public subject route.
import { useState } from 'react'
import { useAuth } from './useAuth'
import { ProtectedActionType } from './authInterruptState'
import { useResumedProtectedAction } from './useAuthInterrupt'
import { SegmentedToggle } from '../symbol/SegmentedToggle'
import { SymbolSearch } from '../symbol/SymbolSearch'
import { ManualWatchlist } from '../watchlists/ManualWatchlist'
import { useWatchlist } from '../watchlists/watchlistContext'
import { useWatchlistSparklines } from '../watchlists/useWatchlistSparklines'
import { WATCHLIST_WINDOWS, type WatchlistWindow } from '../watchlists/watchlistSparklines'

const WINDOW_OPTIONS = WATCHLIST_WINDOWS.map((value) => ({ value, label: value }))

export function WatchlistSection() {
  const { session } = useAuth()
  const userId = session?.userId ?? null
  const watchlist = useWatchlist()
  const [sparkWindow, setSparkWindow] = useState<WatchlistWindow>('1M')
  const sparklines = useWatchlistSparklines(
    watchlist.members.map((member) => member.subject_ref),
    sparkWindow,
  )

  // addSubject swallows rejections into watchlist.message, which ManualWatchlist
  // already renders — no extra error path needed here.
  useResumedProtectedAction(ProtectedActionType.SaveToWatchlist, (action) => {
    void watchlist.addSubject(action.payload.subject_ref)
  })

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
      {userId && watchlist.members.length > 0 ? (
        <div className="px-1.5">
          <SegmentedToggle
            options={WINDOW_OPTIONS}
            value={sparkWindow}
            onChange={setSparkWindow}
            ariaLabel="Watchlist sparkline range"
            testIdPrefix="watchlist-window"
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {userId ? (
          <ManualWatchlist
            members={watchlist.members}
            status={watchlist.status}
            message={watchlist.message}
            onRemove={(ref) => void watchlist.removeSubject(ref)}
            sparklines={sparklines}
          />
        ) : (
          <div className="px-1.5 py-3 text-xs text-muted">Sign in to view your watchlist.</div>
        )}
      </div>
    </section>
  )
}
