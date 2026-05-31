// Left sidebar (redesign IA): brand, vertical primary nav, watchlist group, and
// a user/controls footer — collapsing the prior separate watchlist rail + top
// PrimaryTabs into a single rail per the mockup. All seven workspaces remain
// reachable; nav placement and visual treatment are what change.
import { SessionControl } from './SessionControl'
import { SidebarNav } from './SidebarNav'
import { ThemeToggle } from './ThemeToggle'
import { WatchlistSection } from './WatchlistSection'

export function Sidebar() {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-4 border-r border-line bg-surface px-3 py-4">
      <div className="flex items-center gap-2.5 px-1.5">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-accent to-cyan text-[15px] font-bold text-[#04121f]">
          F
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-[-0.2px] text-fg">Finance Research</div>
          <div className="text-[11px] font-medium text-muted">S&amp;P 100 · agentic</div>
        </div>
      </div>

      <SidebarNav />

      <WatchlistSection />

      <div className="mt-auto flex flex-col gap-2 border-t border-line pt-3">
        <SessionControl />
        <ThemeToggle />
      </div>
    </aside>
  )
}
