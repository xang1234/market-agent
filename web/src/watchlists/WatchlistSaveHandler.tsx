import { ProtectedActionType } from '../shell/authInterruptState'
import { useResumedProtectedAction } from '../shell/useAuthInterrupt'
import { useWatchlist } from './watchlistContext'

// Completes "Save to watchlist" from any page. It lives beside the provider, not in
// the sidebar's watchlist section, which a collapsed sidebar or the Chat page unmounts.
// addSubject reports failures through the watchlist's editError.
export function WatchlistSaveHandler() {
  const watchlist = useWatchlist()
  useResumedProtectedAction(ProtectedActionType.SaveToWatchlist, (action) => {
    void watchlist.addSubject(action.payload.subject_ref)
  })
  return null
}
