import { useContext } from 'react'
import { SidebarSlotContext, type SidebarSlot } from './sidebarSlotContext'

export function useSidebarSlot(): SidebarSlot {
  const slot = useContext(SidebarSlotContext)
  if (!slot) throw new Error('useSidebarSlot must be used inside SidebarSlotProvider')
  return slot
}
