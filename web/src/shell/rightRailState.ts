import type { ReactNode } from 'react'

export type RightRailState =
  | { mode: 'empty' }
  | { mode: 'content'; content: ReactNode }

export function getRightRailState(content: ReactNode): RightRailState {
  if (content == null) return { mode: 'empty' }

  return {
    mode: 'content',
    content,
  }
}
