import { createContext, type Dispatch, type SetStateAction } from 'react'

// The left sidebar is shell-owned. A page can fill its lower section through a
// portal into `node` (Chat lists its threads there), keeping the data in the page.
export type SidebarSlot = {
  node: HTMLElement | null
  setNode: (node: HTMLElement | null) => void
  collapsed: boolean
  setCollapsed: Dispatch<SetStateAction<boolean>>
}

export const SidebarSlotContext = createContext<SidebarSlot | null>(null)
