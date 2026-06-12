import { NavLink } from 'react-router-dom'
import {
  Bot,
  ClipboardCheck,
  Home,
  LineChart,
  MessageSquare,
  Settings,
  SlidersHorizontal,
  Table2,
  type LucideIcon,
} from 'lucide-react'
import { ANALYZE_PATH } from '../analyze/analyzeEntry'
import { webDevFlags } from '../devFlags'
import { NAV_HOTKEYS } from './navHotkeys'

// Path → single-key hint, sourced from the same table the global keydown
// handler uses (useNavHotkeys) so chip and behavior cannot drift.
const HOTKEY_BY_PATH = new Map(NAV_HOTKEYS.map((item) => [item.to, item.key]))

// Vertical primary navigation living in the left sidebar (redesign IA). Carries
// the same workspace set + dev-flag gating as the prior horizontal PrimaryTabs;
// only the placement and visual treatment change. lucide line icons replace the
// emoji/text glyphs called out in the critique.
const PRIMARY_WORKSPACES: ReadonlyArray<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/review', label: 'Review', icon: ClipboardCheck },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/screener', label: 'Screener', icon: SlidersHorizontal },
  { to: ANALYZE_PATH, label: 'Analyze', icon: LineChart },
  { to: '/analyst-grids', label: 'Grids', icon: Table2 },
  ...(webDevFlags.llmSettingsEnabled
    ? [{ to: '/settings', label: 'Settings', icon: Settings }]
    : []),
]

export function SidebarNav() {
  return (
    <nav aria-label="Primary workspaces" className="flex flex-col gap-0.5">
      {PRIMARY_WORKSPACES.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            [
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--color-accent-border)]'
                : 'text-muted hover:bg-surface-hover hover:text-fg',
            ].join(' ')
          }
        >
          <Icon aria-hidden="true" className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
          <span className="flex-1">{label}</span>
          {HOTKEY_BY_PATH.has(to) ? (
            <kbd
              aria-hidden="true"
              className="num rounded border border-line px-1 text-[10px] uppercase text-faint"
            >
              {HOTKEY_BY_PATH.get(to)}
            </kbd>
          ) : null}
        </NavLink>
      ))}
    </nav>
  )
}
