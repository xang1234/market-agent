import type { ReactNode } from 'react'

// Compact violet chip for a subject's sector / category (screener rows, peer
// context). Mirrors ExchangeBadge's shape but uses the violet soft tint from
// the redesign tokens so it flips with the theme via the .dark overrides.
export function SectorChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-md bg-violet-soft px-2 py-0.5 text-xs text-violet">
      {children}
    </span>
  )
}
