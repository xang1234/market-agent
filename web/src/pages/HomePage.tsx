import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BlockView } from '../blocks'
import { webDevFlags } from '../devFlags'
import {
  HOME_DEV_ACTIVITIES,
  HOME_DEV_FEED,
  homeFindingCardLinkState,
  rateLimitActivityStream,
  type HomeAgentSummary,
  type HomeMarketPulseItem,
  type HomePinnedScreen,
  type HomeRunActivity,
  type HomeWatchlistMover,
} from '../home/homeFeed'
import { useRightRail } from '../shell/useRightRail'
import { signedTextClass } from '../symbol/signedColor'

// Home is a findings-first surface. This bead (P0.1.1) only needs the
// scaffolded page — actual Home-feed work is P4.4.
export function HomePage() {
  const { setContent } = useRightRail()

  useEffect(() => {
    setContent(
      <HomeActivityRail activities={rateLimitActivityStream(HOME_DEV_ACTIVITIES, { perAgentLimit: 2 })} />,
    )
    return () => setContent(null)
  }, [setContent])

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
        <h1 className="text-2xl font-semibold">Home</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Cross-agent findings, market pulse, watchlist movers, agent summaries, and pinned screens.
        </p>
        </div>
      </header>
      {webDevFlags.showDevBanner ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          Dev banner flag is enabled. Placeholder services are expected in the local stack.
        </div>
      ) : null}
      <section aria-labelledby="home-findings-heading" className="flex flex-col gap-3">
        <h2 id="home-findings-heading" className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Findings
        </h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {HOME_DEV_FEED.findings.map((finding) => (
            <HomeFindingCard key={finding.block.id} finding={finding} />
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-4">
        <MarketPulse items={HOME_DEV_FEED.marketPulse} />
        <WatchlistMovers movers={HOME_DEV_FEED.watchlistMovers} />
        <AgentSummaries agents={HOME_DEV_FEED.agentSummaries} />
        <PinnedScreens screens={HOME_DEV_FEED.pinnedScreens} />
      </div>
    </div>
  )
}

function HomeFindingCard({ finding }: { finding: (typeof HOME_DEV_FEED.findings)[number] }) {
  const link = homeFindingCardLinkState(finding.destination)
  const content = <BlockView block={finding.block} />
  if (!link.linked) {
    return (
      <div className="opacity-85" aria-disabled="true">
        {content}
      </div>
    )
  }
  return (
    <Link to={link.to} className="block transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100">
      {content}
    </Link>
  )
}

function MarketPulse({ items }: { items: ReadonlyArray<HomeMarketPulseItem> }) {
  return (
    <HomePanel title="Market Pulse">
      <div className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <div>
              <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.label}</div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">{formatTime(item.asOf)}</div>
            </div>
            <div className="text-right">
              <div className="text-sm tabular-nums">{item.value}</div>
              <div className={`text-xs tabular-nums ${signedTextClass(item.movePercent)}`}>{formatMove(item.movePercent)}</div>
            </div>
          </div>
        ))}
      </div>
    </HomePanel>
  )
}

function WatchlistMovers({ movers }: { movers: ReadonlyArray<HomeWatchlistMover> }) {
  return (
    <HomePanel title="Watchlist Movers">
      <div className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
        {movers.map((mover) => (
          <Link key={`${mover.subject_ref.kind}:${mover.subject_ref.id}`} to={`/symbol/${encodeURIComponent(`${mover.subject_ref.kind}:${mover.subject_ref.id}`)}/overview`} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0 hover:text-neutral-900 dark:hover:text-neutral-50">
            <div>
              <div className="text-sm font-medium">{mover.label}</div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">{formatTime(mover.asOf)}</div>
            </div>
            <div className="text-right">
              <div className="text-sm tabular-nums">{mover.price}</div>
              <div className={`text-xs tabular-nums ${signedTextClass(mover.movePercent)}`}>{formatMove(mover.movePercent)}</div>
            </div>
          </Link>
        ))}
      </div>
    </HomePanel>
  )
}

function AgentSummaries({ agents }: { agents: ReadonlyArray<HomeAgentSummary> }) {
  return (
    <HomePanel title="Agent Summaries">
      <div className="flex flex-col gap-3">
        {agents.map((agent) => (
          <div key={agent.agent_id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{agent.name}</span>
              <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[11px] uppercase text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                {agent.status}
              </span>
            </div>
            <p className="text-xs leading-5 text-neutral-600 dark:text-neutral-300">{agent.summary}</p>
          </div>
        ))}
      </div>
    </HomePanel>
  )
}

function PinnedScreens({ screens }: { screens: ReadonlyArray<HomePinnedScreen> }) {
  return (
    <HomePanel title="Pinned Screens">
      <div className="flex flex-col gap-2">
        {screens.map((screen) => (
          <div key={screen.screen_id} className="rounded border border-neutral-200 px-3 py-2 dark:border-neutral-800">
            <div className="text-sm font-medium">{screen.name}</div>
            <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Updated {formatTime(screen.updated_at)}</div>
          </div>
        ))}
      </div>
    </HomePanel>
  )
}

function HomeActivityRail({ activities }: { activities: ReadonlyArray<HomeRunActivity> }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-200 px-4 py-3 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        Activity
      </div>
      <div className="flex flex-col gap-3 overflow-auto p-4">
        {activities.map((activity) => (
          <div key={activity.run_activity_id} className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{activity.stage}</span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatTime(activity.ts)}</span>
            </div>
            <p className="mt-2 text-sm leading-5 text-neutral-800 dark:text-neutral-200">{activity.summary}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function HomePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      {children}
    </section>
  )
}

function formatMove(value: number): string {
  if (Object.is(value, -0) || value === 0) return '0.00%'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
