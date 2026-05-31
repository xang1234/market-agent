import { SymbolSearch } from '../symbol/SymbolSearch'

// Canvas-level top bar. Brand, theme and session moved into the left Sidebar
// (redesign IA); the top bar now hosts the shell-owned global search (spec
// §3.12) with a translucent, blurred backdrop so content scrolls under it.
export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface/70 px-5 backdrop-blur">
      <SymbolSearch placement="topbar" />
    </header>
  )
}
