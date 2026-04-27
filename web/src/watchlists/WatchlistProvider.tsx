// Shared owner of the manual-watchlist membership state. Lifted out of
// WatchlistSlot so the subject-detail header (cw0.10.2) can read membership
// without double-fetching, and so an add from the rail is observed live by
// every surface that derives from the same list.

import type { ReactNode } from 'react'
import { useManualWatchlist } from './useManualWatchlist'
import { WatchlistContext } from './watchlistContext'

export function WatchlistProvider({
  userId,
  children,
}: {
  userId: string | null
  children: ReactNode
}) {
  const watchlist = useManualWatchlist(userId)
  return <WatchlistContext.Provider value={watchlist}>{children}</WatchlistContext.Provider>
}
