// Pure helpers for the watchlist rail's inline sparklines: window → day span,
// member list → ONE batched /v1/market/series query (listing-kind members
// only — other subject kinds have no bar series), and response → closes-by-
// listing map. useWatchlistSparklines stays a thin wrapper over these.

import type { SubjectRef } from '../symbol/search.ts'
import type { GetSeriesResponse, NormalizedSeriesQuery } from '../symbol/series.ts'

export const WATCHLIST_WINDOWS = ['5D', '1M', '6M', 'YTD', '1Y'] as const
export type WatchlistWindow = (typeof WATCHLIST_WINDOWS)[number]

const FIXED_WINDOW_DAYS: Readonly<Record<Exclude<WatchlistWindow, 'YTD'>, number>> = {
  // 7 calendar days ≈ 5 trading bars.
  '5D': 7,
  '1M': 30,
  '6M': 180,
  '1Y': 365,
}

const DAY_MS = 24 * 60 * 60 * 1000

export function watchlistWindowDays(window: WatchlistWindow, now: Date): number {
  if (window !== 'YTD') return FIXED_WINDOW_DAYS[window]
  const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1)
  // Min 7 so a January YTD still has enough bars to draw a line.
  return Math.max(7, Math.floor((now.getTime() - yearStart) / DAY_MS))
}

export function watchlistSeriesQuery(
  members: ReadonlyArray<SubjectRef>,
  window: WatchlistWindow,
  now: Date,
): NormalizedSeriesQuery | null {
  const listings = members.filter(
    (ref): ref is SubjectRef & { kind: 'listing' } => ref.kind === 'listing',
  )
  if (listings.length === 0) return null
  const days = watchlistWindowDays(window, now)
  return {
    subject_refs: listings,
    range: {
      start: new Date(now.getTime() - days * DAY_MS).toISOString(),
      end: now.toISOString(),
    },
    interval: '1d',
    basis: 'split_and_div_adjusted',
    normalization: 'raw',
  }
}

export function sparklineClosesByListing(
  response: GetSeriesResponse,
): Map<string, ReadonlyArray<number>> {
  const map = new Map<string, ReadonlyArray<number>>()
  for (const entry of response.results) {
    if (entry.outcome.outcome !== 'available') continue
    map.set(entry.listing.id, entry.outcome.data.bars.map((bar) => bar.close))
  }
  return map
}
