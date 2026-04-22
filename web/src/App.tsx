import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { WorkspaceShell } from './shell/WorkspaceShell'
import { HomePage } from './pages/HomePage'
import { AgentsPage } from './pages/AgentsPage'
import { ChatPage } from './pages/ChatPage'
import { ScreenerPage } from './pages/ScreenerPage'
import { AnalyzePage } from './pages/AnalyzePage'

// Route model per spec §3.7 + §3.8. WorkspaceShell is the layout route —
// persistent across all primary-workspace transitions. Child routes render
// in <Outlet /> inside the shell's main canvas.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<WorkspaceShell />}>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home" element={<HomePage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="screener" element={<ScreenerPage />} />
          <Route path="analyze" element={<AnalyzePage />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
