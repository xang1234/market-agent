import { useContext } from 'react'
import { RightRailContext } from './rightRailTypes'

export function useRightRail() {
  const ctx = useContext(RightRailContext)
  if (!ctx) throw new Error('useRightRail must be used inside RightRailProvider')
  return ctx
}
