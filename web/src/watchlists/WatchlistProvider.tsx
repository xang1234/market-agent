import { useMemo, type ReactNode } from 'react'
import { useManualWatchlist, type ManualWatchlistState } from './useManualWatchlist'
import { WatchlistContext } from './watchlistContext'

// Mounts useManualWatchlist once at the workspace level so the rail and
// the subject-detail header read from one source — an add from the rail
// is observed live by the header. The context value is memoized so
// consumers don't re-render on every shell render. With userId === null
// the inner hook stays in 'idle' and never fires a fetch (see
// useManualWatchlist).
export function WatchlistProvider({
  userId,
  children,
}: {
  userId: string | null
  children: ReactNode
}) {
  const { members, status, message, addSubject, removeSubject } = useManualWatchlist(userId)
  const value = useMemo<ManualWatchlistState>(
    () => ({ members, status, message, addSubject, removeSubject }),
    [members, status, message, addSubject, removeSubject],
  )
  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>
}
