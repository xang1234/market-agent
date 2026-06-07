import { EvidenceInspectorProvider } from '../evidence/EvidenceInspectorProvider.tsx'
import { WatchlistProvider } from '../watchlists/WatchlistProvider'
import { AuthInterrupt } from './AuthInterrupt'
import { AuthInterruptProvider } from './AuthInterruptProvider'
import { RightRailProvider } from './RightRailProvider'
import { RightRailSlot } from './RightRailSlot'
import { RouteScopeGate } from './RouteScopeGate'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useAuth } from './useAuth'
import { useSearchHotkey } from './useSearchHotkey'

// The persistent workspace shell. Redesign IA collapses the prior separate
// watchlist rail + horizontal PrimaryTabs into a single left Sidebar:
//
//   ┌───────────────┬─────────────────────────────────────────────┐
//   │  Sidebar      │  TopBar: search (⌘K)                         │
//   │  · brand      ├──────────────────────────────┬──────────────┤
//   │  · nav        │                              │  RightRail   │
//   │  · watchlist  │  Outlet (main canvas)        │  (optional)  │
//   │  · user/theme │                              │              │
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
  useSearchHotkey()
  return (
    <AuthInterruptProvider>
      <RightRailProvider>
        <WatchlistProvider userId={userId}>
          <EvidenceInspectorProvider>
            <div className="flex h-full w-full bg-bg text-fg">
              <a
                href="#workspace-main"
                className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:border focus:border-line-strong focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:shadow-md"
              >
                Skip to main content
              </a>
              <Sidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                <TopBar />
                <div className="flex min-h-0 flex-1">
                  <main id="workspace-main" className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <RouteScopeGate />
                  </main>
                  <RightRailSlot />
                </div>
              </div>
            </div>
            <AuthInterrupt />
          </EvidenceInspectorProvider>
        </WatchlistProvider>
      </RightRailProvider>
    </AuthInterruptProvider>
  )
}
