import { SessionControl } from './SessionControl'
import { ThemeToggle } from './ThemeToggle'

// Canvas-level top bar: brand, global search entry, theme, session. Per the
// video target, the shell-owned search lives here (spec §3.12), not per
// surface. The search input is a stub — P0.4 (fra-6al.5) wires up the real
// resolver flow.
export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-sm font-semibold tracking-wide text-neutral-900 dark:text-neutral-100">
        Finance Research
      </div>
      <div className="mx-2 h-6 w-px bg-neutral-200 dark:bg-neutral-800" aria-hidden="true" />
      <input
        type="search"
        disabled
        placeholder="Search ticker, company, theme… (ships with P0.4)"
        aria-label="Search"
        className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700 placeholder:text-neutral-400 disabled:cursor-not-allowed disabled:opacity-75 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:placeholder:text-neutral-500"
      />
      <div className="shrink-0">
        <ThemeToggle />
      </div>
      <div className="shrink-0">
        <SessionControl />
      </div>
    </header>
  )
}
