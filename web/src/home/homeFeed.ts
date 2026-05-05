import { analyzePathForSubject, type AnalyzeIntent } from '../analyze/analyzeEntry.ts'
import type { FindingCardBlock, SubjectRef } from '../blocks/types.ts'
import type { ScreenSubject } from '../screener/savedScreens.ts'
import { subjectRouteParam, symbolDetailPathForSubject } from '../symbol/search.ts'

export type HomeCardDestination =
  | { kind: 'symbol'; subject_ref: SubjectRef; tab?: 'overview' | 'financials' | 'earnings' | 'holders' | 'signals' }
  | { kind: 'analyze'; subject_ref: SubjectRef; intent?: AnalyzeIntent }
  | { kind: 'theme'; theme_ref: SubjectRef & { kind: 'theme' } }
  | { kind: 'none' }

export type HomeFinding = {
  block: FindingCardBlock
  destination: HomeCardDestination
}

export type HomeMarketPulseItem = {
  label: string
  value: string
  movePercent: number
  asOf: string
}

export type HomeWatchlistMover = {
  subject_ref: SubjectRef
  label: string
  price: string
  movePercent: number
  asOf: string
}

export type HomeAgentSummary = {
  agent_id: string
  name: string
  status: 'idle' | 'running' | 'attention'
  summary: string
}

export type HomePinnedScreen = {
  screen_id: string
  name: string
  updated_at: string
}

export type RunActivityStage = 'reading' | 'investigating' | 'found' | 'dismissed'

export type HomeRunActivity = {
  run_activity_id: string
  agent_id: string
  stage: RunActivityStage
  subject_refs: ReadonlyArray<SubjectRef>
  source_refs: ReadonlyArray<string>
  summary: string
  ts: string
}

export type HomeFeed = {
  findings: ReadonlyArray<HomeFinding>
  marketPulse: ReadonlyArray<HomeMarketPulseItem>
  watchlistMovers: ReadonlyArray<HomeWatchlistMover>
  agentSummaries: ReadonlyArray<HomeAgentSummary>
  pinnedScreens: ReadonlyArray<HomePinnedScreen>
}

export type HomeSectionSummary = {
  findings: number
  marketPulse: number
  watchlistMovers: number
  agentSummaries: number
  pinnedScreens: number
}

export function homeCardPath(destination: HomeCardDestination): string | null {
  switch (destination.kind) {
    case 'symbol': {
      if (!destination.tab || destination.tab === 'overview') {
        return symbolDetailPathForSubject(destination.subject_ref)
      }
      return `/symbol/${subjectRouteParam(destination.subject_ref)}/${destination.tab}`
    }
    case 'analyze':
      return analyzePathForSubject(destination.subject_ref, destination.intent)
    case 'theme':
    case 'none':
      return null
  }
}

export function homeFindingCardLinkState(
  destination: HomeCardDestination,
): { linked: true; to: string } | { linked: false; to: null } {
  const to = homeCardPath(destination)
  return to === null ? { linked: false, to } : { linked: true, to }
}

export function summarizeHomeSections(feed: HomeFeed): HomeSectionSummary {
  return {
    findings: feed.findings.length,
    marketPulse: feed.marketPulse.length,
    watchlistMovers: feed.watchlistMovers.length,
    agentSummaries: feed.agentSummaries.length,
    pinnedScreens: feed.pinnedScreens.length,
  }
}

export function pinnedScreensFromSavedScreens(
  screens: ReadonlyArray<ScreenSubject>,
): HomePinnedScreen[] {
  return screens.map((screen) => ({
    screen_id: screen.screen_id,
    name: screen.name,
    updated_at: screen.updated_at,
  }))
}

export function rateLimitActivityStream(
  events: ReadonlyArray<HomeRunActivity>,
  options: { perAgentLimit: number },
): HomeRunActivity[] {
  const counts = new Map<string, number>()
  return [...events]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .filter((event) => {
      const count = counts.get(event.agent_id) ?? 0
      if (count >= options.perAgentLimit) return false
      counts.set(event.agent_id, count + 1)
      return true
    })
}

export const HOME_DEV_FEED: HomeFeed = {
  findings: [
    {
      block: {
        id: 'home-finding-aapl-earnings',
        kind: 'finding_card',
        snapshot_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        data_ref: { kind: 'finding_card', id: 'home-finding-aapl-earnings' },
        source_refs: ['11111111-1111-4111-9111-111111111111'],
        as_of: '2026-05-05T01:00:00.000Z',
        title: 'Guidance watch',
        finding_id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        headline: 'Apple services margin pressure is showing up across recent filings.',
        severity: 'high',
        subject_refs: [{ kind: 'listing', id: '11111111-1111-4111-9111-111111111111' }],
      },
      destination: {
        kind: 'symbol',
        subject_ref: { kind: 'listing', id: '11111111-1111-4111-9111-111111111111' },
        tab: 'earnings',
      },
    },
    {
      block: {
        id: 'home-finding-theme',
        kind: 'finding_card',
        snapshot_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        data_ref: { kind: 'finding_card', id: 'home-finding-theme' },
        source_refs: ['22222222-2222-4222-9222-222222222222'],
        as_of: '2026-05-05T01:05:00.000Z',
        title: 'AI infrastructure',
        finding_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        headline: 'AI capex headlines remain clustered, but the theme route is not shipped yet.',
        severity: 'medium',
        subject_refs: [{ kind: 'theme', id: '22222222-2222-4222-9222-222222222222' }],
      },
      destination: {
        kind: 'theme',
        theme_ref: { kind: 'theme', id: '22222222-2222-4222-9222-222222222222' },
      },
    },
  ],
  marketPulse: [
    { label: 'S&P 500', value: '5,210', movePercent: 0.42, asOf: '2026-05-05T01:00:00.000Z' },
    { label: 'Nasdaq', value: '16,340', movePercent: -0.18, asOf: '2026-05-05T01:00:00.000Z' },
  ],
  watchlistMovers: [
    {
      subject_ref: { kind: 'listing', id: '11111111-1111-4111-9111-111111111111' },
      label: 'AAPL',
      price: '$192.10',
      movePercent: 1.4,
      asOf: '2026-05-05T01:00:00.000Z',
    },
    {
      subject_ref: { kind: 'listing', id: '33333333-3333-4333-9333-333333333333' },
      label: 'MSFT',
      price: '$425.35',
      movePercent: -0.6,
      asOf: '2026-05-05T01:00:00.000Z',
    },
  ],
  agentSummaries: [
    { agent_id: 'agent-earnings', name: 'Earnings watcher', status: 'running', summary: 'Reading 10-Q updates and guidance deltas.' },
    { agent_id: 'agent-risk', name: 'Risk monitor', status: 'attention', summary: 'Found two high-severity supply-chain claims.' },
  ],
  pinnedScreens: [],
}

export const HOME_DEV_ACTIVITIES: ReadonlyArray<HomeRunActivity> = [
  {
    run_activity_id: 'act-4',
    agent_id: 'agent-risk',
    stage: 'found',
    subject_refs: [{ kind: 'listing', id: '33333333-3333-4333-9333-333333333333' }],
    source_refs: ['source-4'],
    summary: 'Found a material guidance update.',
    ts: '2026-05-05T01:08:00.000Z',
  },
  {
    run_activity_id: 'act-3',
    agent_id: 'agent-earnings',
    stage: 'investigating',
    subject_refs: [{ kind: 'listing', id: '11111111-1111-4111-9111-111111111111' }],
    source_refs: ['source-3'],
    summary: 'Investigating margin trend cluster.',
    ts: '2026-05-05T01:07:00.000Z',
  },
  {
    run_activity_id: 'act-2',
    agent_id: 'agent-earnings',
    stage: 'reading',
    subject_refs: [{ kind: 'listing', id: '11111111-1111-4111-9111-111111111111' }],
    source_refs: ['source-2'],
    summary: 'Reading Apple 10-Q.',
    ts: '2026-05-05T01:06:00.000Z',
  },
  {
    run_activity_id: 'act-1',
    agent_id: 'agent-earnings',
    stage: 'dismissed',
    subject_refs: [{ kind: 'listing', id: '11111111-1111-4111-9111-111111111111' }],
    source_refs: ['source-1'],
    summary: 'Dismissed duplicate analyst-note claim.',
    ts: '2026-05-05T01:05:00.000Z',
  },
]
