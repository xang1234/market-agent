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

// Each workspace is its own chunk, so first paint loads the shell and one page.
// The router fetches every matched route's chunk in parallel before it renders,
// and keeps the current page on screen while the next one downloads.
const home = lazyRoute(() => import('./pages/HomePage'), 'HomePage')
const agents = lazyRoute(() => import('./pages/AgentsPage'), 'AgentsPage')
const chat = lazyRoute(() => import('./pages/ChatPage'), 'ChatLayout')
const screener = lazyRoute(() => import('./pages/ScreenerPage'), 'ScreenerPage')
const analyze = lazyRoute(() => import('./pages/AnalyzePage'), 'AnalyzePage')
const grids = lazyRoute(() => import('./analyst-grids/GridsPage.tsx'), 'GridsPage')
const campaignList = lazyRoute(() => import('./discovery/CampaignList.tsx'), 'CampaignList')
const campaign = lazyRoute(() => import('./discovery/CampaignPage.tsx'), 'CampaignPage')
const review = lazyRoute(() => import('./pages/ReviewPage'), 'ReviewPage')
const settings = lazyRoute(() => import('./pages/SettingsPage'), 'SettingsPage')
const subject = lazyRoute(() => import('./shell/SubjectDetailShell'), 'SubjectDetailShell')
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
    <Route element={<WorkspaceShell />}>
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
        <Route path="overview" lazy={lazyRoute(sections, 'OverviewSection')} />
        <Route path="financials" lazy={lazyRoute(sections, 'FinancialsSection')} />
        <Route path="earnings" lazy={lazyRoute(sections, 'EarningsSection')} />
        <Route path="holders" lazy={lazyRoute(sections, 'HoldersSection')} />
        <Route path="signals" lazy={lazyRoute(sections, 'SignalsSection')} />
      </Route>
      <Route path="*" element={<Navigate to={landing} replace />} />
    </Route>,
  ),
  { basename: import.meta.env.BASE_URL },
)

// A tab left open across a deploy asks for page chunks the new build deleted.
// Loading the destination fresh fetches the new build and keeps the user's click.
window.addEventListener('vite:preloadError', () => {
  const pending = router.state.navigation.location
  window.location.assign(pending ? router.createHref(pending) : window.location.href)
})

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
