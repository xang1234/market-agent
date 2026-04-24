import { SessionControl } from './SessionControl'
import { ThemeToggle } from './ThemeToggle'
import { SymbolSearch } from '../symbol/SymbolSearch'

// Canvas-level top bar: brand, global search entry, theme, session. Per the
// video target, the shell-owned search lives here (spec §3.12), not per
// surface.
export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-sm font-semibold tracking-wide text-neutral-900 dark:text-neutral-100">
        Finance Research
      </div>
      <div className="mx-2 h-6 w-px bg-neutral-200 dark:bg-neutral-800" aria-hidden="true" />
      <SymbolSearch placement="topbar" />
      <div className="shrink-0">
        <ThemeToggle />
      </div>
      <div className="shrink-0">
        <SessionControl />
      </div>
    </header>
  )
}
