import type { FindingSeverity } from '../blocks/types.ts'
import type { SubjectRef } from '../symbol/search.ts'
import type { HomeCardDestination } from './deepLinks.ts'

export type HomeFindingCardSummary = {
  home_card_id: string
  headline: string
  severity: FindingSeverity
  support_count: number
  contributing_finding_count: number
  created_at: string
  destination: HomeCardDestination
  subject_refs: ReadonlyArray<SubjectRef>
}

export type HomeListingRef = SubjectRef & { kind: 'listing' }

export type HomeQuoteRow = {
  listing: HomeListingRef
  ticker: string
  mic: string
  price: number
  prev_close: number
  change_abs: number
  change_pct: number
  session_state: 'pre_market' | 'regular' | 'post_market' | 'closed'
  delay_class: 'real_time' | 'delayed_15m' | 'eod' | 'unknown'
  as_of: string
  currency: string
}

export type HomeOmittedListing = { listing: HomeListingRef; reason: 'no_quote' }

export type HomeMarketPulse = {
  rows: ReadonlyArray<HomeQuoteRow>
  omitted: ReadonlyArray<HomeOmittedListing>
}

export type HomeWatchlistMoversReason = 'ok' | 'no_default_watchlist' | 'empty_watchlist'

export type HomeWatchlistMovers = {
  reason: HomeWatchlistMoversReason
  rows: ReadonlyArray<HomeQuoteRow>
  omitted: ReadonlyArray<HomeOmittedListing>
}

export type HomeAgentLastRun = {
  agent_run_log_id: string
  status: 'running' | 'completed' | 'failed'
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  error: string | null
}

export type HomeAgentLatestFinding = {
  finding_id: string
  headline: string
  severity: Extract<FindingSeverity, 'high' | 'critical'>
  created_at: string
}

export type HomeAgentSummaryRow = {
  agent_id: string
  name: string
  enabled: true
  last_run: HomeAgentLastRun | null
  finding_counts: {
    total: number
    high_or_critical: number
    critical: number
  }
  latest_high_or_critical_finding: HomeAgentLatestFinding | null
}

export type HomeAgentSummaries = {
  window_hours: number
  rows: ReadonlyArray<HomeAgentSummaryRow>
}

export type HomeSavedScreenRow = {
  screen_id: string
  name: string
  filter_summary: string
  updated_at: string
  replay_target: SubjectRef & { kind: 'screen' }
}

export type HomeSavedScreens = { rows: ReadonlyArray<HomeSavedScreenRow> }

export type HomeSummary = {
  generated_at: string
  findings: { cards: ReadonlyArray<HomeFindingCardSummary> }
  market_pulse: HomeMarketPulse
  watchlist_movers: HomeWatchlistMovers
  agent_summaries: HomeAgentSummaries
  saved_screens: HomeSavedScreens
}

type FetchImpl = typeof fetch

type CallArgs = {
  userId: string
  endpoint?: string
  fetchImpl?: FetchImpl
  signal?: AbortSignal
}

export async function fetchHomeSummary(args: CallArgs): Promise<HomeSummary> {
  const endpoint = args.endpoint ?? '/v1/home/summary'
  const response = await (args.fetchImpl ?? fetch)(endpoint, {
    headers: { 'x-user-id': args.userId },
    signal: args.signal,
  })
  if (!response.ok) {
    void response.body?.cancel()
    throw new Error(`fetch home summary failed with HTTP ${response.status}`)
  }
  return (await response.json()) as HomeSummary
}
