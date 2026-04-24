import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import { QuoteSnapshot } from '../symbol/QuoteSnapshot'
import {
  isResolvedSubject,
  subjectFromRouteParam,
  type ResolvedSubject,
} from '../symbol/search'

// Entered subject-detail shell. Swapped into the workspace shell's main
// canvas at `/symbol/:subjectRef/...`, owning:
//   - the subject header with display identity and first quote snapshot
//   - local section navigation (Overview / Financials / Earnings /
//     Holders / Signals)
//   - an <Outlet /> for section content
//
// The outer workspace shell (watchlist, top bar, primary tabs, activity
// rail) stays mounted across subject entry and across section switches —
// only the main-canvas contents of the subject shell change.
//
// Per spec §3.11, subject detail is PUBLIC: public market data, findings,
// and subject context may render without a session. Protected actions
// (save to watchlist, start chat on this subject) reuse the inline auth
// interrupt from fra-6al.1.3 rather than gating the route.
//
// Section list is durable (spec §3.8). `signals` is the extensible section
// for community / sentiment / news pulse / future alt-data; it is
// deliberately not a source-specific `/reddit` or `/news` route.
const SECTIONS = [
  { to: 'overview', label: 'Overview' },
  { to: 'financials', label: 'Financials' },
  { to: 'earnings', label: 'Earnings' },
  { to: 'holders', label: 'Holders' },
  { to: 'signals', label: 'Signals' },
] as const

export function SubjectDetailShell() {
  const { subjectRef } = useParams<{ subjectRef: string }>()
  const location = useLocation()
  const subject = subjectFromLocationState(location.state) ?? subjectFromRouteParam(subjectRef)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        data-testid="subject-header"
        className="border-b border-neutral-200 px-8 py-5 dark:border-neutral-800"
      >
        <QuoteSnapshot subject={subject} />
      </header>
      <nav
        aria-label="Subject sections"
        className="flex h-10 shrink-0 items-center gap-1 border-b border-neutral-200 px-4 dark:border-neutral-800"
      >
        {SECTIONS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end
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
      <div className="flex min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}

function subjectFromLocationState(state: unknown): ResolvedSubject | null {
  if (typeof state !== 'object' || state === null) return null
  const subject = (state as { subject?: unknown }).subject
  return isResolvedSubject(subject) ? subject : null
}
