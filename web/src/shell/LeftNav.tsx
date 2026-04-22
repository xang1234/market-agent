import { NavLink } from 'react-router-dom'
import { SessionControl } from './SessionControl'
import { ThemeToggle } from './ThemeToggle'

// Primary workspaces, per spec §3.7. These are app navigation route groups,
// not /v1/* HTTP endpoint groups. Symbol detail is an entered route group
// keyed by canonical SubjectRef, reached from any surface — not a left-nav item.
//
// Protected surfaces are still listed in the nav even when unauthenticated;
// clicking them is allowed and intentional — the route enters and the main
// canvas collapses to the in-shell auth gate (spec §3.10).
const PRIMARY_WORKSPACES = [
  { to: '/home', label: 'Home' },
  { to: '/agents', label: 'Agents' },
  { to: '/chat', label: 'Chat' },
  { to: '/screener', label: 'Screener' },
  { to: '/analyze', label: 'Analyze' },
] as const

export function LeftNav() {
  return (
    <nav className="flex h-full w-48 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-4 py-4 text-sm font-semibold tracking-wide text-neutral-700 dark:border-neutral-800 dark:text-neutral-200">
        Finance Research
      </div>
      <ul className="flex flex-1 flex-col gap-1 px-2 py-3">
        {PRIMARY_WORKSPACES.map(({ to, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                [
                  'block rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                    : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
                ].join(' ')
              }
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <ThemeToggle />
      </div>
      <SessionControl />
    </nav>
  )
}
