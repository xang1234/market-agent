import { Outlet } from 'react-router-dom'
import { LeftNav } from './LeftNav'
import { RightRailProvider, RightRailSlot } from './RightRailSlot'

// The persistent workspace shell. Owns three regions: left nav, main canvas,
// right-rail slot. The shell does NOT unmount when the user navigates between
// primary workspaces — only the main canvas swaps out via <Outlet />.
//
// Shell chrome is not auth-gated as a whole; public routes (Home, Screener,
// Analyze-entry, entered symbol detail) render inside the same shell as
// protected routes (Chat, Agents, user-owned watchlists). In-shell auth gates
// live inside protected main-canvas content (coming in P0.1.2).
export function WorkspaceShell() {
  return (
    <RightRailProvider>
      <div className="flex h-full w-full bg-neutral-50 text-neutral-900">
        <LeftNav />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
        <RightRailSlot />
      </div>
    </RightRailProvider>
  )
}
