import { ScreenerWorkspace } from '../screener/ScreenerWorkspace.tsx'

// Screener defaults to a denser main-canvas layout and does NOT opt into the
// right rail. Per spec §3.7: "Screener defaults to a denser main-canvas layout
// and may opt into the rail later without changing the shell contract."
//
// The workspace owns query controls and result rows in a single surface
// (bead fra-cw0.8.1). Saving a screen lives behind a session interrupt
// (bead fra-cw0.8.2) and is not part of this surface yet.
export function ScreenerPage() {
  return <ScreenerWorkspace />
}
