import { useMemo, useState, type ReactNode } from 'react'
import { RightRailContext, type RightRailContextValue } from './rightRailTypes'

export function RightRailProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null)
  const value = useMemo<RightRailContextValue>(() => ({ content, setContent }), [content])
  return <RightRailContext.Provider value={value}>{children}</RightRailContext.Provider>
}
