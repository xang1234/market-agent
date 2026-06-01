import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { analyzeEntryFromSubject } from '../analyze/analyzeEntry'
import { QuoteSnapshot } from '../symbol/QuoteSnapshot'
import { subjectDisplayName } from '../symbol/quote'
import { PANEL_CLASS } from '../symbol/surfaceStyles.ts'
import {
  fetchSubjectHydration,
  isCanonicalResolvedSubject,
  isSymbolDetailTab,
  planSymbolResolution,
  resolveSubjects,
  subjectNeedsHydration,
  subjectFromRouteParam,
  subjectFromRouterState,
  symbolDetailPathForSubject,
  type ResolvedSubject,
  type SymbolDetailTab,
} from '../symbol/search'
import { SubjectMembershipBadges } from '../watchlists/SubjectMembershipBadges'
import { useAuth } from './useAuth'
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
] satisfies ReadonlyArray<{ to: SymbolDetailTab; label: string }>

const HEADER_ACTION_CLASS =
  'inline-flex items-center gap-1 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-fg-soft transition-colors hover:border-accent hover:text-fg'

type LegacyRouteResolutionState =
  | { status: 'idle' }
  | { status: 'ambiguous'; ticker: string; candidates: ReadonlyArray<ResolvedSubject> }
  | { status: 'not_found'; ticker: string; message: string }
  | { status: 'error'; ticker: string; message: string }

type HydrationState =
  | { status: 'idle' }
  | { status: 'error'; key: string; message: string }

export function SubjectDetailShell() {
  const { subjectRef } = useParams<{ subjectRef: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const routeSubject = useMemo(() => subjectFromRouteParam(subjectRef), [subjectRef])
  const currentTab = useMemo(() => tabFromPathname(location.pathname), [location.pathname])
  const baseSubject = subjectFromRouterState(location.state) ?? routeSubject
  const legacyTicker =
    routeSubject.subject_ref.kind === 'legacy_listing_route'
      ? routeSubject.subject_ref.ticker
      : null
  const [legacyResolution, setLegacyResolution] = useState<LegacyRouteResolutionState>({
    status: 'idle',
  })
  const [hydratedSubject, setHydratedSubject] = useState<ResolvedSubject | null>(null)
  const [hydrationState, setHydrationState] = useState<HydrationState>({ status: 'idle' })
  const canonicalBaseSubject = isCanonicalResolvedSubject(baseSubject) ? baseSubject : null
  const canonicalBaseSubjectKey =
    canonicalBaseSubject === null ? null : subjectKey(canonicalBaseSubject)
  const needsHydration = canonicalBaseSubject !== null && subjectNeedsHydration(canonicalBaseSubject)
  const { session } = useAuth()
  const userId = session?.userId ?? null
  const hydratedSubjectMatchesBase =
    canonicalBaseSubject !== null &&
    hydratedSubject?.subject_ref.kind === canonicalBaseSubject.subject_ref.kind &&
    hydratedSubject.subject_ref.id === canonicalBaseSubject.subject_ref.id
  const subject = needsHydration && hydratedSubjectMatchesBase ? hydratedSubject : baseSubject
  const canonicalSubject = isCanonicalResolvedSubject(subject) ? subject : null
  const shouldBlockForHydration = needsHydration && !hydratedSubjectMatchesBase
  const hydrationError =
    hydrationState.status === 'error' && hydrationState.key === canonicalBaseSubjectKey
      ? hydrationState.message
      : null
  const visibleLegacyResolution =
    legacyTicker !== null &&
    legacyResolution.status !== 'idle' &&
    legacyResolution.ticker === legacyTicker.trim()
      ? legacyResolution
      : ({ status: 'idle' } as const)

  useEffect(() => {
    if (legacyTicker === null) {
      return
    }

    const ticker = legacyTicker.trim()
    if (!ticker) {
      return
    }

    const controller = new AbortController()
    resolveSubjects({ text: ticker, signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        const plan = planSymbolResolution(response)
        if (plan.state === 'enter_subject') {
          navigate(symbolDetailPathForSubject(plan.subject.subject_ref, currentTab), {
            replace: true,
            state: { subject: plan.subject },
          })
          return
        }
        if (plan.state === 'needs_choice') {
          setLegacyResolution({
            status: 'ambiguous',
            ticker,
            candidates: plan.candidates,
          })
          return
        }
        setLegacyResolution({
          status: 'not_found',
          ticker,
          message: `No subject found for ${plan.unresolved || ticker}.`,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLegacyResolution({
          status: 'error',
          ticker,
          message: errorMessage(error, 'Subject resolve failed.'),
        })
      })

    return () => controller.abort()
  }, [currentTab, legacyTicker, navigate])

  useEffect(() => {
    if (!needsHydration || canonicalBaseSubject === null || canonicalBaseSubjectKey === null) {
      return
    }

    const controller = new AbortController()
    fetchSubjectHydration({
      subject_ref: canonicalBaseSubject.subject_ref,
      signal: controller.signal,
    })
      .then((hydrated) => {
        if (controller.signal.aborted) return
        setHydratedSubject(hydrated)
        setHydrationState({ status: 'idle' })
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return
        setHydratedSubject(null)
        setHydrationState({
          status: 'error',
          key: canonicalBaseSubjectKey,
          message: errorMessage(error, 'Subject hydration failed.'),
        })
      })

    return () => controller.abort()
  }, [canonicalBaseSubject, canonicalBaseSubjectKey, needsHydration])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        data-testid="subject-header"
        className="border-b border-line px-8 py-5"
      >
        <QuoteSnapshot subject={subject} />
        {userId !== null && canonicalSubject !== null ? (
          <SubjectMembershipBadges subjectRef={canonicalSubject.subject_ref} userId={userId} />
        ) : null}
        <div className="mt-4 flex items-center gap-2">
          {canonicalSubject !== null ? (
            <>
              <SaveToWatchlistButton subject={canonicalSubject} />
              <AnalyzeThisSubjectButton subject={canonicalSubject} />
            </>
          ) : null}
        </div>
      </header>
      <nav
        aria-label="Subject sections"
        className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-4"
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
                  ? 'font-medium text-fg after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-accent'
                  : 'text-muted hover:text-fg',
              ].join(' ')
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="flex min-h-0 flex-1 overflow-auto">
        {legacyTicker !== null ? (
          <LegacyRouteResolutionView
            ticker={legacyTicker}
            state={visibleLegacyResolution}
            currentTab={currentTab}
          />
        ) : shouldBlockForHydration ? (
          <SubjectContextNotice
            title={hydrationError ? 'Subject context unavailable' : 'Loading subject context'}
            message={hydrationError ?? 'Loading issuer context for this subject.'}
          />
        ) : (
          <Outlet context={{ subject } satisfies SubjectDetailOutletContext} />
        )}
      </div>
    </div>
  )
}

function LegacyRouteResolutionView({
  ticker,
  state,
  currentTab,
}: {
  ticker: string
  state: LegacyRouteResolutionState
  currentTab: SymbolDetailTab
}) {
  const normalizedTicker = ticker.trim()
  if (!normalizedTicker) {
    return (
      <SubjectContextNotice
        title="Subject context unavailable"
        message="No subject found for this route."
      />
    )
  }
  if (state.status === 'ambiguous') {
    return <LegacySubjectChoice state={state} currentTab={currentTab} />
  }
  if (state.status === 'not_found' || state.status === 'error') {
    return <SubjectContextNotice title="Subject context unavailable" message={state.message} />
  }
  return (
    <SubjectContextNotice
      title="Loading subject context"
      message={`Resolving ${normalizedTicker} before loading this section.`}
    />
  )
}

function LegacySubjectChoice({
  state,
  currentTab,
}: {
  state: Extract<LegacyRouteResolutionState, { status: 'ambiguous' }>
  currentTab: SymbolDetailTab
}) {
  return (
    <section className="flex w-full flex-col gap-4 p-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-fg">
          Choose a listing to continue
        </h2>
        <p className="text-sm text-muted">
          Multiple matches were found for {state.ticker}. Select the listing to load this
          section.
        </p>
      </div>
      <ul className="grid gap-2 sm:max-w-xl">
        {state.candidates.map((candidate) => (
          <li key={`${candidate.subject_ref.kind}:${candidate.subject_ref.id}`}>
            <Link
              replace
              to={symbolDetailPathForSubject(candidate.subject_ref, currentTab)}
              state={{ subject: candidate }}
              className={`flex items-center justify-between ${PANEL_CLASS} px-3 py-2 text-sm text-fg transition-colors hover:border-line-strong hover:bg-surface-hover`}
            >
              <span>{subjectDisplayName(candidate)}</span>
              <span className="text-xs text-muted">
                {candidate.subject_ref.kind}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SubjectContextNotice({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <section className="flex w-full flex-col gap-2 p-8">
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      <p className="text-sm text-muted">{message}</p>
    </section>
  )
}

function tabFromPathname(pathname: string): SymbolDetailTab {
  const maybeTab = pathname.split('/').filter(Boolean).at(-1)
  return isSymbolDetailTab(maybeTab) ? maybeTab : 'overview'
}

function subjectKey(subject: ResolvedSubject): string {
  return `${subject.subject_ref.kind}:${subject.subject_ref.id}`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
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
