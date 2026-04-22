import { Outlet } from 'react-router-dom'
import { AuthInterrupt } from './AuthInterrupt'
import { AuthInterruptProvider } from './AuthInterruptProvider'
import { PrimaryTabs } from './PrimaryTabs'
import { RightRailProvider, RightRailSlot } from './RightRailSlot'
import { TopBar } from './TopBar'
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
// gates for protected main-canvas content are enforced by <ProtectedSurface>
// in App.tsx, rendered inside <Outlet /> — the shell itself stays mounted
// across auth transitions.
//
// The shell also owns the <AuthInterrupt /> modal (P0.1.3): public surfaces
// fire protected actions via useRequestProtectedAction, and this single
// modal instance handles the sign-in prompt + action resume across all
// surfaces.
export function WorkspaceShell() {
  return (
    <AuthInterruptProvider>
      <RightRailProvider>
        <div className="flex h-full w-full bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
          <WatchlistSlot />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <PrimaryTabs />
            <div className="flex min-h-0 flex-1">
              <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <Outlet />
              </main>
              <RightRailSlot />
            </div>
          </div>
        </div>
        <AuthInterrupt />
      </RightRailProvider>
    </AuthInterruptProvider>
  )
}
