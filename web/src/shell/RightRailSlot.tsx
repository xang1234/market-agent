import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

// The right rail is SHELL-OWNED, not surface-owned. Surfaces opt in to the rail
// by pushing content via `useRightRail` (from a child route). Screener defaults
// to a denser main-canvas layout and does not opt in.
type RightRailContextValue = {
  content: ReactNode
  setContent: (node: ReactNode) => void
}

const RightRailContext = createContext<RightRailContextValue | null>(null)

export function RightRailProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null)
  const value = useMemo(() => ({ content, setContent }), [content])
  return <RightRailContext.Provider value={value}>{children}</RightRailContext.Provider>
}

export function useRightRail() {
  const ctx = useContext(RightRailContext)
  if (!ctx) throw new Error('useRightRail must be used inside RightRailProvider')
  return ctx
}

export function RightRailSlot() {
  const { content } = useRightRail()
  if (content == null) return null
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-neutral-200 bg-white">
      {content}
    </aside>
  )
}
