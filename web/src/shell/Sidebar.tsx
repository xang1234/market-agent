// Left sidebar (redesign IA): brand, vertical primary nav, a lower section, and
// a user/controls footer. The lower section is the watchlist, or on Chat the
// chat list, which ChatLayout portals into the slot. Collapsed, the sidebar is
// an icon rail on every page.
import { useLayoutEffect, useRef } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useMatch } from 'react-router-dom'
import { SessionControl } from './SessionControl'
import { SidebarNav } from './SidebarNav'
import { useSidebarSlot } from './useSidebarSlot'
import { ThemeToggle } from './ThemeToggle'
import { WatchlistSection } from './WatchlistSection'

const TOGGLE_CLASS = 'grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-hover hover:text-fg'

function BrandMark() {
  return (
    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-linear-to-br from-accent to-cyan text-[15px] font-bold text-on-accent">
      F
    </div>
  )
}

export function Sidebar() {
  const { collapsed, setCollapsed, setNode } = useSidebarSlot()
  const onChat = useMatch('/chat/*') !== null
  // Collapsing swaps one toggle for the other; focus follows a toggle the user pressed.
  const toggle = useRef<HTMLButtonElement>(null)
  const refocusToggle = useRef(false)
  useLayoutEffect(() => {
    if (!refocusToggle.current) return
    refocusToggle.current = false
    toggle.current?.focus()
  }, [collapsed])
  const flip = (next: boolean) => {
    refocusToggle.current = true
    setCollapsed(next)
  }

  if (collapsed) {
    return (
      <aside className="flex h-full w-14 shrink-0 flex-col items-center gap-4 border-r border-line bg-surface py-4">
        <BrandMark />
        <SidebarNav compact />
        <button ref={toggle} type="button" aria-label="Expand sidebar" title="Expand sidebar" onClick={() => flip(false)} className={`mt-auto ${TOGGLE_CLASS}`}>
          <PanelLeftOpen aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-4 border-r border-line bg-surface px-3 py-4">
      <div className="flex items-center gap-2.5 px-1.5">
        <BrandMark />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-sm font-semibold tracking-[-0.2px] text-fg">Finance Research</div>
          <div className="text-[11px] font-medium text-muted">S&amp;P 100 · agentic</div>
        </div>
        <button ref={toggle} type="button" aria-label="Collapse sidebar" title="Collapse sidebar" onClick={() => flip(true)} className={TOGGLE_CLASS}>
          <PanelLeftClose aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>

      <SidebarNav />

      {onChat ? <div ref={setNode} className="flex min-h-0 flex-1 flex-col" /> : <WatchlistSection />}

      <div className="mt-auto flex flex-col gap-2 border-t border-line pt-3">
        <SessionControl />
        <ThemeToggle />
      </div>
    </aside>
  )
}
