import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { webDevFlags } from '../devFlags'
import { PANEL_CLASS } from '../symbol/surfaceStyles.ts'
import { homeCardPath } from '../home/deepLinks.ts'
import { authenticatedFetch } from '../http/authFetch.ts'
import {
  fetchHomeSummary,
  type HomeAgentSummaryRow,
  type HomeFindingCardSummary,
  type HomeQuoteRow,
  type HomeSavedScreenRow,
  type HomeSummary,
  type HomeWatchlistMovers,
} from '../home/summaryClient.ts'
import {
  agentLastRunLabel,
  agentSummaryHeadline,
  formatChangePercent,
  formatPrice,
  quoteDirection,
  savedScreenSubtitle,
  watchlistMoversEmptyState,
} from '../home/summaryView.ts'
import { useAuth } from '../shell/useAuth.ts'
import { useRightRail } from '../shell/useRightRail'

type HomeRunActivityStage = 'reading' | 'investigating' | 'found' | 'dismissed'

type HomeRunActivity = {
  run_activity_id: string
  agent_id: string
  stage: HomeRunActivityStage
  summary: string
  ts: string
}

type ParsedRunActivity = {
  seq: number
  activity: HomeRunActivity
}

const EMPTY_HOME_ACTIVITIES: ReadonlyArray<HomeRunActivity> = []

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; summary: HomeSummary }

export function HomePage() {
  const { setContent } = useRightRail()
  const { session } = useAuth()
  const userId = session?.userId ?? null
  const [activityState, setActivityState] = useState<{
    userId: string | null
    lastSeq: number | null
    activities: ReadonlyArray<HomeRunActivity>
  }>(() => ({ userId: null, lastSeq: null, activities: [] }))
  const activities = activityState.userId === userId ? activityState.activities : EMPTY_HOME_ACTIVITIES

  useEffect(() => {
    setContent(
      <HomeActivityRail activities={rateLimitActivityStream(activities, { perAgentLimit: 2 })} />,
    )
    return () => setContent(null)
  }, [activities, setContent])

  useEffect(() => {
    if (userId === null) return

    const controller = new AbortController()
    let lastEventId: number | null = null
    void consumeRunActivityStreamWithRetry({
      signal: controller.signal,
      userId,
      lastEventId: () => lastEventId,
      resetLastEventId: () => {
        lastEventId = null
      },
      onEvent: (event) => {
        lastEventId = event.seq
        setActivityState((current) => ({
          userId,
          lastSeq: event.seq,
          activities: mergeActivities(
            [event.activity],
            current.userId === userId ? current.activities : [],
          ),
        }))
      },
    })
    return () => controller.abort()
  }, [userId])

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
      <header>
        <h1 className="text-2xl font-semibold">Home</h1>
        <p className="mt-1 text-sm text-muted">
          Cross-agent findings, market pulse, watchlist movers, agent summaries, pinned screens.
        </p>
      </header>
      {webDevFlags.showDevBanner ? (
        <div className="rounded-md border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">
          Dev banner flag is enabled. Placeholder services are expected in the local stack.
        </div>
      ) : null}
      {userId === null ? (
        <SignInHint />
      ) : (
        // Keyed on userId so that switching users discards the previous user's
        // ready/error state synchronously instead of leaving it visible until
        // the new fetch resolves.
        <UserHomeContent key={userId} userId={userId} />
      )}
    </div>
  )
}

export function UserHomeContent({
  userId,
  fetchImpl,
}: {
  userId: string
  fetchImpl?: typeof fetch
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetchHomeSummary({ userId, signal: controller.signal, fetchImpl })
      .then((summary) => {
        if (controller.signal.aborted) return
        setState({ kind: 'ready', summary })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => controller.abort()
  }, [userId, fetchImpl])

  return <UserHomeView state={state} />
}

export function UserHomeView({ state }: { state: LoadState }) {
  if (state.kind === 'loading') return <LoadingHint />
  if (state.kind === 'error') return <ErrorHint message={state.message} />
  return <SummaryView summary={state.summary} />
}

function SignInHint() {
  return (
    <Section title="Sign in to load Home">
      <p className="text-sm text-muted">
        Home loads cross-agent findings and market sections for the signed-in user.
      </p>
    </Section>
  )
}

function LoadingHint() {
  return (
    <Section title="Loading Home...">
      <p className="text-sm text-muted">Fetching your latest findings and market sections.</p>
    </Section>
  )
}

function ErrorHint({ message }: { message: string }) {
  return (
    <Section title="Home is unavailable">
      <p className="text-sm text-negative">{message}</p>
    </Section>
  )
}

function SummaryView({ summary }: { summary: HomeSummary }) {
  return (
    <div className="flex flex-col gap-6">
      <FindingsSection cards={summary.findings.cards} />
      <MarketPulseSection rows={summary.market_pulse.rows} omittedCount={summary.market_pulse.omitted.length} />
      <WatchlistMoversSection movers={summary.watchlist_movers} />
      <AgentSummariesSection rows={summary.agent_summaries.rows} windowHours={summary.agent_summaries.window_hours} />
      <SavedScreensSection rows={summary.saved_screens.rows} />
    </div>
  )
}

function FindingsSection({ cards }: { cards: ReadonlyArray<HomeFindingCardSummary> }) {
  return (
    <Section title="Findings">
      {cards.length === 0 ? (
        <EmptyHint>No findings yet from your active agents.</EmptyHint>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => (
            <li key={card.home_card_id}>
              <FindingRow card={card} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

const FINDING_ROW_BASE = `block ${PANEL_CLASS} p-3`
const FINDING_ROW_LINKED = `${FINDING_ROW_BASE} hover:border-line-strong`

function FindingRow({ card }: { card: HomeFindingCardSummary }) {
  const path = homeCardPath(card.destination)
  const body = (
    <div className="flex flex-col">
      <span className="text-sm font-medium">{card.headline}</span>
      <span className="text-xs uppercase tracking-wide text-muted">
        {card.severity} · <span className="num">{card.support_count}</span> sources · {card.created_at}
      </span>
    </div>
  )
  if (path === null) return <div className={FINDING_ROW_BASE}>{body}</div>
  return (
    <Link to={path} className={FINDING_ROW_LINKED}>
      {body}
    </Link>
  )
}

function MarketPulseSection({
  rows,
  omittedCount,
}: {
  rows: ReadonlyArray<HomeQuoteRow>
  omittedCount: number
}) {
  return (
    <Section title="Market pulse">
      {rows.length === 0 ? (
        <EmptyHint>Market pulse is not configured for this environment.</EmptyHint>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {rows.map((row) => (
            <li key={row.listing.id}>
              <QuoteCell row={row} />
            </li>
          ))}
        </ul>
      )}
      {omittedCount > 0 ? <FootnoteHint>{omittedCount} subjects had no quote.</FootnoteHint> : null}
    </Section>
  )
}

function WatchlistMoversSection({ movers }: { movers: HomeWatchlistMovers }) {
  return (
    <Section title="Watchlist movers">
      <WatchlistMoversBody movers={movers} />
      {movers.omitted.length > 0 ? <FootnoteHint>{movers.omitted.length} listings had no quote.</FootnoteHint> : null}
    </Section>
  )
}

function WatchlistMoversBody({ movers }: { movers: HomeWatchlistMovers }) {
  const empty = watchlistMoversEmptyState(movers.reason)
  if (empty !== null) return <EmptyHint>{empty}</EmptyHint>
  if (movers.rows.length === 0) return <EmptyHint>No quotable listings in your watchlist.</EmptyHint>
  return (
    <ul className="flex flex-col gap-2">
      {movers.rows.map((row) => (
        <li key={row.listing.id}>
          <QuoteCell row={row} />
        </li>
      ))}
    </ul>
  )
}

function QuoteCell({ row }: { row: HomeQuoteRow }) {
  const direction = quoteDirection(row)
  const tone =
    direction === 'up'
      ? 'text-positive'
      : direction === 'down'
        ? 'text-negative'
        : 'text-muted'
  return (
    <div className={`${PANEL_CLASS} p-3`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          {row.ticker}
          <span className="ml-1 text-xs font-normal text-faint">{row.mic}</span>
        </span>
        <span className={`num text-sm font-semibold ${tone}`}>{formatChangePercent(row.change_pct)}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-xs text-muted">
        <span className="num">{formatPrice(row.price, row.currency)}</span>
        <span className="uppercase">{row.delay_class.replace('_', ' ')}</span>
      </div>
    </div>
  )
}

function AgentSummariesSection({
  rows,
  windowHours,
}: {
  rows: ReadonlyArray<HomeAgentSummaryRow>
  windowHours: number
}) {
  return (
    <Section title="Agent summaries" subtitle={`Last ${windowHours}h`}>
      {rows.length === 0 ? (
        <EmptyHint>No agents enabled for this user.</EmptyHint>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.agent_id} className={`${PANEL_CLASS} p-3`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{row.name}</span>
                <span className="text-xs uppercase tracking-wide text-muted">{agentLastRunLabel(row)}</span>
              </div>
              <div className="mt-1 text-sm text-fg">{agentSummaryHeadline(row)}</div>
              <div className="mt-1 text-xs text-muted">
                <span className="num">{row.finding_counts.total}</span> total ·{' '}
                <span className="num">{row.finding_counts.high_or_critical}</span> high+ ·{' '}
                <span className="num">{row.finding_counts.critical}</span> critical
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function SavedScreensSection({ rows }: { rows: ReadonlyArray<HomeSavedScreenRow> }) {
  return (
    <Section title="Pinned screens">
      {rows.length === 0 ? (
        <EmptyHint>No saved screens yet.</EmptyHint>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.screen_id}
              className={`${PANEL_CLASS} p-3`}
            >
              <div className="text-sm font-medium">{row.name}</div>
              <div className="mt-1 text-xs text-muted">{savedScreenSubtitle(row)}</div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function HomeActivityRail({ activities }: { activities: ReadonlyArray<HomeRunActivity> }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3 text-xs uppercase tracking-wide text-muted">
        Activity
      </div>
      <div className="flex flex-col gap-3 overflow-auto p-4">
        {activities.length === 0 ? (
          <p className="text-xs leading-5 text-muted">No recent activity.</p>
        ) : (
          activities.map((activity) => (
            <div key={activity.run_activity_id} className="rounded border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">{activity.stage}</span>
                <span className="text-xs text-muted">{formatActivityTime(activity.ts)}</span>
              </div>
              <p className="mt-2 text-sm leading-5 text-fg">{activity.summary}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {subtitle !== undefined ? (
          <span className="text-xs uppercase tracking-wide text-faint">{subtitle}</span>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${PANEL_CLASS} p-4 text-sm text-muted`}>
      {children}
    </div>
  )
}

function FootnoteHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs text-faint">{children}</p>
}

async function consumeRunActivityStream({
  signal,
  userId,
  lastEventId,
  onEvent,
}: {
  signal: AbortSignal
  userId: string
  lastEventId: number | null
  onEvent(event: ParsedRunActivity): void
}) {
  const headers: Record<string, string> = {}
  if (lastEventId !== null) headers['Last-Event-ID'] = String(lastEventId)
  const response = await authenticatedFetch('/v1/run-activities/stream', {
    userId,
    credentials: 'same-origin',
    headers,
    signal,
  })
  if (!response.ok || response.body === null) {
    throw new RunActivityStreamError(response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (!signal.aborted) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event = parseRunActivitySseBlock(block)
        if (event !== null) {
          onEvent(event)
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

async function consumeRunActivityStreamWithRetry({
  signal,
  userId,
  lastEventId,
  resetLastEventId,
  onEvent,
}: {
  signal: AbortSignal
  userId: string
  lastEventId: () => number | null
  resetLastEventId: () => void
  onEvent(event: ParsedRunActivity): void
}) {
  let retryCount = 0
  while (!signal.aborted) {
    try {
      await consumeRunActivityStream({
        signal,
        userId,
        lastEventId: lastEventId(),
        onEvent,
      })
      retryCount = 0
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof RunActivityStreamError && error.status === 400) {
        resetLastEventId()
      }
      retryCount += 1
    }
    if (signal.aborted) return
    await sleepForRetry(retryDelayMs(retryCount), signal)
  }
}

function parseRunActivitySseBlock(block: string): ParsedRunActivity | null {
  let eventName: string | null = null
  let eventId: string | null = null
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('id: ')) {
      eventId = line.slice('id: '.length)
    } else if (line.startsWith('event: ')) {
      eventName = line.slice('event: '.length)
    } else if (line.startsWith('data: ')) {
      data.push(line.slice('data: '.length))
    }
  }
  if (eventName !== 'run_activity' || data.length === 0) {
    return null
  }
  const parsed = parseRunActivityData(data.join('\n'))
  if (parsed === null) return null
  const seq = parseSseSeq(eventId) ?? parseSseSeq(parsed.seq)
  return seq === null ? null : { seq, activity: parsed.activity }
}

function parseRunActivityData(data: string): { seq?: unknown; activity: HomeRunActivity } | null {
  try {
    const parsed = JSON.parse(data) as { seq?: unknown; activity?: HomeRunActivity }
    return parsed.activity ? { seq: parsed.seq, activity: parsed.activity } : null
  } catch {
    return null
  }
}

function parseSseSeq(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function retryDelayMs(retryCount: number): number {
  return Math.min(500 * 2 ** Math.max(0, retryCount - 1), 5_000)
}

function sleepForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timeout)
      resolve()
    }, { once: true })
  })
}

class RunActivityStreamError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`run activity stream failed with HTTP ${status}`)
    this.status = status
  }
}

function mergeActivities(
  incoming: ReadonlyArray<HomeRunActivity>,
  current: ReadonlyArray<HomeRunActivity>,
): ReadonlyArray<HomeRunActivity> {
  const byId = new Map<string, HomeRunActivity>()
  for (const activity of [...incoming, ...current]) {
    byId.set(activity.run_activity_id, activity)
  }
  return [...byId.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 100)
}

function rateLimitActivityStream(
  activities: ReadonlyArray<HomeRunActivity>,
  options: { perAgentLimit: number },
): ReadonlyArray<HomeRunActivity> {
  const perAgentCounts = new Map<string, number>()
  const limited: HomeRunActivity[] = []
  for (const activity of activities) {
    const count = perAgentCounts.get(activity.agent_id) ?? 0
    if (count >= options.perAgentLimit) continue
    perAgentCounts.set(activity.agent_id, count + 1)
    limited.push(activity)
  }
  return limited
}

function formatActivityTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
