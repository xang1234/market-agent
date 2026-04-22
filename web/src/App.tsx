import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './shell/AuthContext'
import { ProtectedSurface } from './shell/ProtectedSurface'
import { WorkspaceShell } from './shell/WorkspaceShell'
import { HomePage } from './pages/HomePage'
import { AgentsPage } from './pages/AgentsPage'
import { ChatPage } from './pages/ChatPage'
import { ScreenerPage } from './pages/ScreenerPage'
import { AnalyzePage } from './pages/AnalyzePage'

// Route model per spec §3.7 + §3.8. WorkspaceShell is the layout route —
// persistent across all primary-workspace transitions. Child routes render
// in <Outlet /> inside the shell's main canvas.
//
// Protected surfaces (Chat, Agents) are wrapped in <ProtectedSurface> — a
// *content-level* guard, not a redirect. Unauthenticated entry keeps the
// shell mounted and swaps only the main-canvas content for the auth gate.
export function App() {
  return (
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
                  <ChatPage />
                </ProtectedSurface>
              }
            />
            <Route path="screener" element={<ScreenerPage />} />
            <Route path="analyze" element={<AnalyzePage />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
