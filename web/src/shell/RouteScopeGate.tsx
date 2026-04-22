import { Outlet, useMatches } from 'react-router-dom'
import { AuthGate } from './AuthGate'
import { resolveRouteHandle } from './routeHandle'
import { useAuth } from './useAuth'

// Reads the matched-route chain via useMatches(), locates the deepest
// RouteHandle with `scope: 'protected'`, and renders the AuthGate in place
// of Outlet when the user is unauthed (bead fra-6al.2.3).
//
// Lives inside WorkspaceShell's <main> region, so the gate swap only
// affects main-canvas content — the outer shell (watchlist, top bar,
// tabs, activity rail) stays mounted across auth transitions (spec §3.10).
export function RouteScopeGate() {
  const matches = useMatches()
  const { session } = useAuth()

  const handle = resolveRouteHandle(matches)
  if (handle?.scope === 'protected' && session == null) {
    return <AuthGate destinationLabel={handle.label ?? 'this section'} />
  }
  return <Outlet />
}
