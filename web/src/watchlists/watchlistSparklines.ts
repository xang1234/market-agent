// Watchlist-rail sparkline plumbing: the rail's window vocabulary, member
// list → ONE batched /v1/market/series query (listing-kind members only —
// other subject kinds have no bar series), and response → closes-by-listing
// map. Range math and query construction live in the canonical helpers in
// symbol/series.ts; useWatchlistSparklines stays a thin wrapper over these.

import type { SubjectRef } from '../symbol/search.ts'
import {
  dailySeriesQuery,
  type GetSeriesResponse,
  type NormalizedSeriesQuery,
} from '../symbol/series.ts'

export const WATCHLIST_WINDOWS = ['5D', '1M', '6M', 'YTD', '1Y'] as const
export type WatchlistWindow = (typeof WATCHLIST_WINDOWS)[number]

export function watchlistSeriesQuery(
  members: ReadonlyArray<SubjectRef>,
  window: WatchlistWindow,
  now: Date,
): NormalizedSeriesQuery | null {
  const listings = members.filter(
    (ref): ref is SubjectRef & { kind: 'listing' } => ref.kind === 'listing',
  )
  return dailySeriesQuery(listings, window, 'raw', now)
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
