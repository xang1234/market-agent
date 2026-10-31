import type { ComponentType } from 'react'
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
} from 'react-router-dom'
import { BlockRegistryProvider, createDefaultBlockRegistry } from './blocks'
import { AuthProvider } from './shell/AuthContext'
import { DEFAULT_MOCK_SESSION } from './shell/authTypes'
import { webDevFlags } from './devFlags'
import type { RouteHandle } from './shell/routeHandle'
import { ThemeProvider } from './shell/ThemeProvider'
import { Announcer } from './ui/Announcer.tsx'
import { WorkspaceShell } from './shell/WorkspaceShell'
import { lazyRoute } from './shell/lazyRoute'
import { PageLoadError, ShellFrame } from './shell/RouteFallbacks'

// Each workspace is its own chunk. The router fetches every matched route's
// chunk in parallel before it renders the shell, which ShellFrame stands in for,
// and keeps the current page on screen while the next one downloads.
// Where a failed page chunk should reload to: the address being opened, or null
// when the navigation that wanted the chunk has since settled elsewhere.
// `router` is unassigned while the router is created, so a holder stands in.
let activeRouter: ReturnType<typeof createBrowserRouter> | null = null
const destination = () => {
  if (!activeRouter?.state.initialized) return window.location.href
  const pending = activeRouter.state.navigation.location
  return pending ? activeRouter.createHref(pending) : null
}
const page = <M extends Record<K, ComponentType>, K extends keyof M & string>(load: () => Promise<M>, name: K) =>
  lazyRoute(load, name, destination)
const home = page(() => import('./pages/HomePage'), 'HomePage')
const agents = page(() => import('./pages/AgentsPage'), 'AgentsPage')
const chat = page(() => import('./pages/ChatPage'), 'ChatLayout')
const screener = page(() => import('./pages/ScreenerPage'), 'ScreenerPage')
const analyze = page(() => import('./pages/AnalyzePage'), 'AnalyzePage')
const grids = page(() => import('./analyst-grids/GridsPage.tsx'), 'GridsPage')
const campaignList = page(() => import('./discovery/CampaignList.tsx'), 'CampaignList')
const campaign = page(() => import('./discovery/CampaignPage.tsx'), 'CampaignPage')
const review = page(() => import('./pages/ReviewPage'), 'ReviewPage')
const settings = page(() => import('./pages/SettingsPage'), 'SettingsPage')
const subject = page(() => import('./shell/SubjectDetailShell'), 'SubjectDetailShell')
const sections = () => import('./pages/symbol/sections')

// Route scope handles. Declarative metadata (bead fra-6al.2.3) consumed by
// RouteScopeGate in WorkspaceShell — no per-route guard wrappers needed.
// Child routes inherit parent scope via useMatches().
const publicHandle: RouteHandle = { scope: 'public' }
const protAgents: RouteHandle = { scope: 'protected', label: 'Agents' }
const protChat: RouteHandle = { scope: 'protected', label: 'Chat' }
const protReview: RouteHandle = { scope: 'protected', label: 'Review' }
const protSettings: RouteHandle = { scope: 'protected', label: 'Settings' }
const protDiscovery: RouteHandle = { scope: 'protected', label: 'Discover' }

// Route model per spec §3.7 + §3.8. WorkspaceShell is the layout route —
// persistent across all primary-workspace transitions. Child routes render
// via RouteScopeGate inside the shell's main canvas.
//
// Scope assignments come from spec §3.10:
//   public:    Home, Screener, Analyze-entry, Symbol detail
//   protected: Chat (+ threads), Agents
//
// createBrowserRouter is the v7 data-router API, required for useMatches()
// (which RouteScopeGate depends on). createRoutesFromElements preserves the
// readable JSX route tree.
//
// The demo has recordings only for Chat, so it lands there.
const landing = webDevFlags.demo ? '/chat' : '/home'
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<WorkspaceShell />} HydrateFallback={ShellFrame}>
      <Route errorElement={<PageLoadError />}>
        <Route index element={<Navigate to={landing} replace />} />
        <Route path="home" handle={publicHandle} lazy={home} />
        <Route path="agents" handle={protAgents} lazy={agents} />
        <Route path="review" handle={protReview} lazy={review} />
        <Route path="settings" handle={protSettings} lazy={settings} />
        <Route path="chat" handle={protChat} lazy={chat}>
          <Route path=":threadId" element={null} />
        </Route>
        <Route path="screener" handle={publicHandle} lazy={screener} />
        <Route path="analyze" handle={publicHandle} lazy={analyze} />
        <Route path="analyst-grids" handle={publicHandle} lazy={grids} />
        <Route path="discovery" handle={protDiscovery} lazy={campaignList} />
        <Route path="discovery/:campaignId" handle={protDiscovery} lazy={campaign} />
        <Route path="discovery/:campaignId/runs/:runId" handle={protDiscovery} lazy={campaign} />
        <Route path="symbol/:subjectRef" handle={publicHandle} lazy={subject}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" lazy={page(sections, 'OverviewSection')} />
          <Route path="financials" lazy={page(sections, 'FinancialsSection')} />
          <Route path="earnings" lazy={page(sections, 'EarningsSection')} />
          <Route path="holders" lazy={page(sections, 'HoldersSection')} />
          <Route path="signals" lazy={page(sections, 'SignalsSection')} />
        </Route>
        <Route path="*" element={<Navigate to={landing} replace />} />
      </Route>
    </Route>,
  ),
  { basename: import.meta.env.BASE_URL },
)
activeRouter = router

// Module scope: stable registry identity across <App /> re-renders.
const blockRegistry = createDefaultBlockRegistry()

// ThemeProvider stays at the layout level so the `dark` class toggle on <html>
// stays coherent across route changes and auth transitions.
export function App() {
  return (
    <BlockRegistryProvider registry={blockRegistry}>
      <ThemeProvider>
        <AuthProvider initialSession={webDevFlags.devAutoLogin ? DEFAULT_MOCK_SESSION : null}>
          <RouterProvider router={router} />
          <Announcer />
        </AuthProvider>
      </ThemeProvider>
    </BlockRegistryProvider>
  )
}
