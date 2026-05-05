import {
  formatQuotePrice,
  formatSignedPercent,
  quoteDirection as quoteDirectionByMove,
  type QuoteDirection,
} from '../symbol/quote.ts'
import type {
  HomeAgentSummaryRow,
  HomeQuoteRow,
  HomeSavedScreenRow,
  HomeWatchlistMoversReason,
} from './summaryClient.ts'

export function formatChangePercent(changePct: number): string {
  if (!Number.isFinite(changePct)) return '—'
  return formatSignedPercent(changePct * 100)
}

export function formatPrice(price: number, currency: string): string {
  if (!Number.isFinite(price)) return '—'
  return formatQuotePrice(price, currency)
}

export function quoteDirection(row: Pick<HomeQuoteRow, 'change_abs'>): QuoteDirection {
  return quoteDirectionByMove({ absolute_move: row.change_abs })
}

export function watchlistMoversEmptyState(reason: HomeWatchlistMoversReason): string | null {
  if (reason === 'no_default_watchlist') return 'Add tickers to your watchlist to see movers.'
  if (reason === 'empty_watchlist') return 'Your watchlist is empty.'
  return null
}

export function agentSummaryHeadline(row: HomeAgentSummaryRow): string {
  if (row.latest_high_or_critical_finding) return row.latest_high_or_critical_finding.headline
  if (row.finding_counts.total > 0) {
    const word = row.finding_counts.total === 1 ? 'finding' : 'findings'
    return `${row.finding_counts.total} ${word} in window.`
  }
  if (row.last_run === null) return 'No runs yet.'
  if (row.last_run.status === 'failed') return 'Last run failed.'
  return 'No new findings in window.'
}

export function agentLastRunLabel(row: HomeAgentSummaryRow): string {
  if (row.last_run === null) return 'Never run'
  if (row.last_run.status === 'running') return 'Running now'
  const ended = row.last_run.ended_at ?? row.last_run.started_at
  return `${row.last_run.status === 'failed' ? 'Failed' : 'Completed'} · ${ended}`
}

export function savedScreenSubtitle(row: HomeSavedScreenRow): string {
  return `${row.filter_summary} · updated ${row.updated_at}`
}
