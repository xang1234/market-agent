import { NavLink } from 'react-router-dom'
import { ANALYZE_PATH } from '../analyze/analyzeEntry'

// Horizontal workspace tabs, sitting in the main-canvas header per the video
// target. Replaces the prior left-nav list (bead fra-4pz IA refactor).
// Analyze stays in the tab set — top-level workspace that also accepts
// deep-linked SubjectRef context (spec §3.7).
const PRIMARY_WORKSPACES = [
  { to: '/home', label: 'Home' },
  { to: '/agents', label: 'Agents' },
  { to: '/chat', label: 'Chat' },
  { to: '/screener', label: 'Screener' },
  { to: ANALYZE_PATH, label: 'Analyze' },
] as const

export function PrimaryTabs() {
  return (
    <nav
      aria-label="Primary workspaces"
      className="flex h-10 shrink-0 items-center gap-1 border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      {PRIMARY_WORKSPACES.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            [
              'relative flex h-full items-center px-3 text-sm transition-colors',
              isActive
                ? 'font-medium text-neutral-900 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-neutral-900 dark:text-neutral-100 dark:after:bg-neutral-100'
                : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
            ].join(' ')
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
