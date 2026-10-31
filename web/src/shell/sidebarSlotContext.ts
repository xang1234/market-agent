import { createContext, type Dispatch, type SetStateAction } from 'react'

// The left sidebar is shell-owned. A page claims its lower section, which then
// shows `node` instead of the watchlist, and portals into it (Chat lists its
// threads there). A portal, unlike the right rail's pushed ReactNode, keeps a live
// list such as Chat's in the page's own tree, with its state and focus handling.
export type SidebarSlot = {
  claimed: boolean
  setClaimed: (claimed: boolean) => void
  node: HTMLElement | null
  setNode: (node: HTMLElement | null) => void
  collapsed: boolean
  setCollapsed: Dispatch<SetStateAction<boolean>>
}

export const SidebarSlotContext = createContext<SidebarSlot | null>(null)
