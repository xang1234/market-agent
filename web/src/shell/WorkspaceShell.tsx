import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigation } from 'react-router-dom'
import { EvidenceInspectorDock, EvidenceInspectorProvider } from '../evidence/EvidenceInspectorProvider.tsx'
import { WatchlistProvider } from '../watchlists/WatchlistProvider'
import { AuthInterrupt } from './AuthInterrupt'
import { AuthInterruptProvider } from './AuthInterruptProvider'
import { RightRailProvider } from './RightRailProvider'
import { RightRailSlot } from './RightRailSlot'
import { RouteScopeGate } from './RouteScopeGate'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useAuth } from './useAuth'
import { useNavHotkeys } from './useNavHotkeys'
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
// While the evidence inspector is open it docks in the RightRail column, and
// the rail's content returns when it closes.
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
  useNavHotkeys()
  const navigating = useNavigation().state !== 'idle'
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  // A page that does not scroll itself scrolls the canvas, which outlives it.
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [pathname])
  return (
    <AuthInterruptProvider>
      <RightRailProvider>
        <WatchlistProvider userId={userId}>
          <EvidenceInspectorProvider>
            <div className="flex h-full w-full bg-bg text-fg">
              <div
                aria-hidden="true"
                className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-accent transition-opacity ${navigating ? 'opacity-100 delay-150' : 'opacity-0'}`}
              />
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
                  <main ref={mainRef} id="workspace-main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col overflow-auto">
                    <RouteScopeGate />
                  </main>
                  <EvidenceInspectorDock fallback={<RightRailSlot />} />
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
