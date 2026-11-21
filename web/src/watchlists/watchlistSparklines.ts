// Watchlist-rail sparkline plumbing: member list → ONE batched
// /v1/market/series query of intraday bars (listing-kind members only —
// other subject kinds have no bar series), and response → closes of each
// listing's latest session. The rail shows one trading day so the line
// describes the same day as the change pill beside it (#728).

import { defineResource } from '../fetch/resource.ts'
import type { SubjectRef } from '../symbol/search.ts'
import {
  fetchSeries,
  type GetSeriesResponse,
  type NormalizedBar,
  type NormalizedSeriesQuery,
} from '../symbol/series.ts'

const HOUR_MS = 60 * 60 * 1000
// A week back always reaches the latest session, across weekends and holidays.
const LOOKBACK_MS = 7 * 24 * HOUR_MS
// Polygon's extended-hours bars stop at 20:00 and resume at 04:00 exchange
// time, so a quiet stretch this long separates two sessions.
// ponytail: gap split, not an exchange calendar; an illiquid listing with no
// trades for this long mid-session draws only the bars after the gap.
const SESSION_GAP_MS = 4 * HOUR_MS

export function watchlistSeriesQuery(
  members: ReadonlyArray<SubjectRef>,
  now: Date,
): NormalizedSeriesQuery | null {
  const listings = members.filter(
    (ref): ref is SubjectRef & { kind: 'listing' } => ref.kind === 'listing',
  )
  if (listings.length === 0) return null
  return {
    subject_refs: listings,
    range: { start: new Date(now.getTime() - LOOKBACK_MS).toISOString(), end: now.toISOString() },
    interval: '15m',
    basis: 'split_adjusted',
    normalization: 'raw',
  }
}

// The bars after the last session gap, so a weekend or holiday shows the most
// recent session.
function latestSessionBars(bars: ReadonlyArray<NormalizedBar>): ReadonlyArray<NormalizedBar> {
  let start = 0
  for (let i = 1; i < bars.length; i += 1) {
    if (Date.parse(bars[i].ts) - Date.parse(bars[i - 1].ts) >= SESSION_GAP_MS) start = i
  }
  return bars.slice(start)
}

export function sparklineClosesByListing(
  response: GetSeriesResponse,
): Map<string, ReadonlyArray<number>> {
  const map = new Map<string, ReadonlyArray<number>>()
  for (const entry of response.results) {
    if (entry.outcome.outcome !== 'available') continue
    map.set(entry.listing.id, latestSessionBars(entry.outcome.data.bars).map((bar) => bar.close))
  }
  return map
}

// Callers pass deduplicated, sorted listing ids so one membership set is one
// entry whatever its member order.
export const watchlistSparklines = defineResource({
  freshness: 'intraday',
  load: async (
    { listingIds }: { listingIds: ReadonlyArray<string> },
    signal,
  ) => {
    const members = listingIds.map((id): SubjectRef => ({ kind: 'listing', id }))
    const query = watchlistSeriesQuery(members, new Date())
    if (query === null) return { kind: 'unavailable', reason: 'no listing members' }
    const response = await fetchSeries(query, { signal })
    const closes = sparklineClosesByListing(response)
    if (closes.size === 0) return { kind: 'unavailable', reason: 'no sparklines available' }
    return closes.size < listingIds.length
      ? { kind: 'ready', data: closes, incomplete: true }
      : { kind: 'ready', data: closes }
  },
})
