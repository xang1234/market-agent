import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './shell/AuthContext'
import { ProtectedSurface } from './shell/ProtectedSurface'
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

// Route model per spec §3.7 + §3.8. WorkspaceShell is the layout route —
// persistent across all primary-workspace transitions. Child routes render
// in <Outlet /> inside the shell's main canvas.
//
// Protected surfaces (Chat, Agents) are wrapped in <ProtectedSurface> — a
// *content-level* guard, not a redirect. Unauthenticated entry keeps the
// shell mounted and swaps only the main-canvas content for the auth gate.
//
// ThemeProvider sits at the top so the `dark` class toggle on <html> stays
// coherent across route changes and auth transitions.
export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<WorkspaceShell />}>
              <Route index element={<Navigate to="/home" replace />} />
              <Route path="home" element={<HomePage />} />
              <Route
                path="agents"
                element={
                  <ProtectedSurface destinationLabel="Agents">
                    <AgentsPage />
                  </ProtectedSurface>
                }
              />
              <Route
                path="chat"
                element={
                  <ProtectedSurface destinationLabel="Chat">
                    <ChatLayout />
                  </ProtectedSurface>
                }
              >
                <Route index element={<ChatEmptyState />} />
                <Route path=":threadId" element={<ChatThreadView />} />
              </Route>
              <Route path="screener" element={<ScreenerPage />} />
              <Route path="analyze" element={<AnalyzePage />} />
              <Route path="symbol/:subjectRef" element={<SubjectDetailShell />}>
                <Route index element={<Navigate to="overview" replace />} />
                <Route path="overview" element={<OverviewSection />} />
                <Route path="financials" element={<FinancialsSection />} />
                <Route path="earnings" element={<EarningsSection />} />
                <Route path="holders" element={<HoldersSection />} />
                <Route path="signals" element={<SignalsSection />} />
              </Route>
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
