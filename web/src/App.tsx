import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
} from 'react-router-dom'
import { BlockRegistryProvider, createDefaultBlockRegistry } from './blocks'
import { AuthProvider } from './shell/AuthContext'
import type { RouteHandle } from './shell/routeHandle'
import { ThemeProvider } from './shell/ThemeProvider'
import { WorkspaceShell } from './shell/WorkspaceShell'
import { HomePage } from './pages/HomePage'
import { AgentsPage } from './pages/AgentsPage'
import { ChatEmptyState, ChatLayout, ChatThreadView } from './pages/ChatPage'
import { ScreenerPage } from './pages/ScreenerPage'
import { AnalyzePage } from './pages/AnalyzePage'
import { SubjectDetailShell } from './shell/SubjectDetailShell'
import {
  EarningsSection,
  FinancialsSection,
  HoldersSection,
  OverviewSection,
  SignalsSection,
} from './pages/symbol/sections'

// Route scope handles. Declarative metadata (bead fra-6al.2.3) consumed by
// RouteScopeGate in WorkspaceShell — no per-route guard wrappers needed.
// Child routes inherit parent scope via useMatches().
const publicHandle: RouteHandle = { scope: 'public' }
const protAgents: RouteHandle = { scope: 'protected', label: 'Agents' }
const protChat: RouteHandle = { scope: 'protected', label: 'Chat' }

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
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<WorkspaceShell />}>
      <Route index element={<Navigate to="/home" replace />} />
      <Route path="home" handle={publicHandle} element={<HomePage />} />
      <Route path="agents" handle={protAgents} element={<AgentsPage />} />
      <Route path="chat" handle={protChat} element={<ChatLayout />}>
        <Route index element={<ChatEmptyState />} />
        <Route path=":threadId" element={<ChatThreadView />} />
      </Route>
      <Route path="screener" handle={publicHandle} element={<ScreenerPage />} />
      <Route path="analyze" handle={publicHandle} element={<AnalyzePage />} />
      <Route path="symbol/:subjectRef" handle={publicHandle} element={<SubjectDetailShell />}>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<OverviewSection />} />
        <Route path="financials" element={<FinancialsSection />} />
        <Route path="earnings" element={<EarningsSection />} />
        <Route path="holders" element={<HoldersSection />} />
        <Route path="signals" element={<SignalsSection />} />
      </Route>
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Route>,
  ),
)

// Module scope: stable registry identity across <App /> re-renders.
const blockRegistry = createDefaultBlockRegistry()

// ThemeProvider stays at the layout level so the `dark` class toggle on <html>
// stays coherent across route changes and auth transitions.
export function App() {
  return (
    <BlockRegistryProvider registry={blockRegistry}>
      <ThemeProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ThemeProvider>
    </BlockRegistryProvider>
  )
}
