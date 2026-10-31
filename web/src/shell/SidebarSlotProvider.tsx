import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { SidebarSlotContext, type SidebarSlot } from './sidebarSlotContext'

const COLLAPSED_KEY = 'sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

export function SidebarSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed))
    } catch {
      // Unstorable: the choice lasts until reload.
    }
  }, [collapsed])
  const value = useMemo<SidebarSlot>(() => ({ node, setNode, collapsed, setCollapsed }), [node, collapsed])
  return <SidebarSlotContext.Provider value={value}>{children}</SidebarSlotContext.Provider>
}
