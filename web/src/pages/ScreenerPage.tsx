import { ScreenerWorkspace } from '../screener/ScreenerWorkspace.tsx'

// Screener defaults to a denser main-canvas layout and does NOT opt into the
// right rail. Per spec §3.7: "Screener defaults to a denser main-canvas layout
// and may opt into the rail later without changing the shell contract."
export function ScreenerPage() {
  return <ScreenerWorkspace />
}
