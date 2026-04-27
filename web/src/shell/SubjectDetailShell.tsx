import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import { analyzeEntryFromSubject } from '../analyze/analyzeEntry'
import { QuoteSnapshot } from '../symbol/QuoteSnapshot'
import { subjectDisplayName } from '../symbol/quote'
import {
  subjectFromRouteParam,
  subjectFromRouterState,
  type ResolvedSubject,
} from '../symbol/search'
import { ProtectedActionType } from './authInterruptState'
import type { SubjectDetailOutletContext } from './subjectDetailOutletContext'
import { useRequestProtectedAction } from './useAuthInterrupt'

// Entered subject-detail shell. Swapped into the workspace shell's main
// canvas at `/symbol/:subjectRef/...`, owning:
//   - the subject header with display identity, first quote snapshot, and
//     the Save-to-watchlist CTA (P0.4b inline auth interrupt entry, fra-6al.6.3)
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

const HEADER_ACTION_CLASS =
  'inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-500 dark:hover:text-neutral-50'

export function SubjectDetailShell() {
  const { subjectRef } = useParams<{ subjectRef: string }>()
  const location = useLocation()
  const subject = subjectFromRouterState(location.state) ?? subjectFromRouteParam(subjectRef)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        data-testid="subject-header"
        className="border-b border-neutral-200 px-8 py-5 dark:border-neutral-800"
      >
        <QuoteSnapshot subject={subject} />
        <div className="mt-4 flex items-center gap-2">
          <SaveToWatchlistButton subject={subject} />
          <AnalyzeThisSubjectButton subject={subject} />
        </div>
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
        <Outlet context={{ subject } satisfies SubjectDetailOutletContext} />
      </div>
    </div>
  )
}

// Public-route entry point for the watchlist save action. Unauth clicks
// fire the inline auth interrupt with the resolved SubjectRef preserved
// in the pending payload; AuthInterruptProvider re-dispatches after sign-
// in and WatchlistSlot's resume handler completes the membership add.
function SaveToWatchlistButton({ subject }: { subject: ResolvedSubject }) {
  const requestProtectedAction = useRequestProtectedAction()
  const displayName = subjectDisplayName(subject)

  const handleClick = () => {
    requestProtectedAction({
      title: 'Sign in to save to watchlist',
      description: `Saving ${displayName} to your watchlist requires sign-in. We'll bring you right back here.`,
      action: {
        actionType: ProtectedActionType.SaveToWatchlist,
        payload: {
          subject_ref: subject.subject_ref,
          display_name: displayName,
        },
      },
    })
  }

  return (
    <button
      type="button"
      data-testid="save-to-watchlist"
      onClick={handleClick}
      className={HEADER_ACTION_CLASS}
    >
      <span aria-hidden="true">+</span>
      Save to watchlist
    </button>
  )
}

// Top-level workspace transition: Analyze stays a primary workspace and
// must NOT become a nested symbol-detail tab (spec §3.4.4). A real `<Link>`
// (not navigate-on-click) preserves middle-click / cmd-click / right-click
// semantics; the carried router state lets AnalyzePage render context
// without re-resolving from raw text.
function AnalyzeThisSubjectButton({ subject }: { subject: ResolvedSubject }) {
  const entry = analyzeEntryFromSubject(subject)
  const displayName = subjectDisplayName(subject)
  return (
    <Link
      data-testid="analyze-this-subject"
      to={entry.to}
      state={entry.state}
      aria-label={`Analyze ${displayName}`}
      className={HEADER_ACTION_CLASS}
    >
      Analyze
    </Link>
  )
}
