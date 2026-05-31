import { NavLink } from 'react-router-dom'
import {
  Bot,
  ClipboardCheck,
  Home,
  LineChart,
  MessageSquare,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { ANALYZE_PATH } from '../analyze/analyzeEntry'
import { webDevFlags } from '../devFlags'

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
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
