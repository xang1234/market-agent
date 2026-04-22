import { createContext, type ReactNode } from 'react'

// The right rail is SHELL-OWNED, not surface-owned. Surfaces opt in to the
// rail by pushing content via `useRightRail` (from a child route). The rail
// itself stays mounted across navigations regardless of whether content is
// pushed — so main-canvas width is stable when switching tabs.
//
// Spec §3.7 carves out Screener as using a denser main-canvas layout; that
// opt-out gets wired in when the Screener surface ships (fra-cw0.8).
export type RightRailContextValue = {
  content: ReactNode
  setContent: (node: ReactNode) => void
}

export const RightRailContext = createContext<RightRailContextValue | null>(null)
