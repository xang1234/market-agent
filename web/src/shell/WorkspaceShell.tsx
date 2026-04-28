import { WatchlistProvider } from '../watchlists/WatchlistProvider'
import { AuthInterrupt } from './AuthInterrupt'
import { AuthInterruptProvider } from './AuthInterruptProvider'
import { PrimaryTabs } from './PrimaryTabs'
import { RightRailProvider } from './RightRailProvider'
import { RightRailSlot } from './RightRailSlot'
import { RouteScopeGate } from './RouteScopeGate'
import { TopBar } from './TopBar'
import { useAuth } from './useAuth'
import { WatchlistSlot } from './WatchlistSlot'

// The persistent workspace shell. Per the video target (bead fra-4pz IA
// refactor), the layout is:
//
//   ┌───────────────┬─────────────────────────────────────────────┐
//   │               │  TopBar: brand · search · theme · session    │
//   │  Watchlist    ├──────────────────────────────┬──────────────┤
//   │  (left rail)  │  PrimaryTabs                 │  RightRail   │
//   │               ├──────────────────────────────┤  (optional)  │
//   │               │  Outlet (main canvas)        │              │
//   └───────────────┴──────────────────────────────┴──────────────┘
//
// Shell chrome is not auth-gated as a whole; public routes (Home, Screener,
// Analyze-entry, entered symbol detail) render inside the same shell as
// protected routes (Chat, Agents, user-owned watchlists). In-shell auth
// gates for protected main-canvas content are driven by route-level scope
// metadata (fra-6al.2.3) — each route declares `handle: { scope, label }`
// and <RouteScopeGate /> walks useMatches() to swap in <AuthGate /> when
// the current match is protected and the session is null. The shell
// itself stays mounted across auth transitions.
//
// The shell also owns the <AuthInterrupt /> modal (P0.1.3): public surfaces
// fire protected actions via useRequestProtectedAction, and this single
// modal instance handles the sign-in prompt + action resume across all
// surfaces.
export function WorkspaceShell() {
  const { session } = useAuth()
  const userId = session?.userId ?? null
  return (
    <AuthInterruptProvider>
      <RightRailProvider>
        <WatchlistProvider userId={userId}>
          <div className="flex h-full w-full bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
            <WatchlistSlot />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar />
              <PrimaryTabs />
              <div className="flex min-h-0 flex-1">
                <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  <RouteScopeGate />
                </main>
                <RightRailSlot />
              </div>
            </div>
          </div>
          <AuthInterrupt />
        </WatchlistProvider>
      </RightRailProvider>
    </AuthInterruptProvider>
  )
}
