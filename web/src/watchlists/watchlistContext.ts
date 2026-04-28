// Context object + hook for the shared manual-watchlist state. Lives in
// its own .ts module (no JSX) so the consumer hook is callable without
// dragging in the provider's component code, and so the lint rule about
// component-only exports stays happy.

import { createContext, useContext } from 'react'
import type { ManualWatchlistState } from './useManualWatchlist'

export const WatchlistContext = createContext<ManualWatchlistState | null>(null)

export function useWatchlist(): ManualWatchlistState {
  const ctx = useContext(WatchlistContext)
  if (ctx === null) {
    throw new Error('useWatchlist must be used inside <WatchlistProvider>')
  }
  return ctx
}
