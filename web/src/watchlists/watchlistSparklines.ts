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
const DAY_MS = 24 * HOUR_MS
// A week back always reaches the latest session, across weekends and holidays.
const LOOKBACK_DAYS = 7
// Polygon's extended-hours bars run 04:00 to 20:00 exchange time, so the last
// bar of a session (19:45) and the first of the next (04:00) sit at least
// 8h15m apart. A gap over 8h is always between sessions, and quiet stretches
// of up to 8h inside one keep it whole.
// ponytail: gap split, not an exchange calendar; an illiquid listing with no
// trades for over 8h mid-session draws only the bars after the gap.
const SESSION_GAP_MS = 8 * HOUR_MS

export function watchlistSeriesQuery(
  members: ReadonlyArray<SubjectRef>,
  now: Date,
): NormalizedSeriesQuery | null {
  const listings = members.filter(
    (ref): ref is SubjectRef & { kind: 'listing' } => ref.kind === 'listing',
  )
  if (listings.length === 0) return null
  // Whole UTC days, ending at the end of today: the market service keys its
  // bar cache on the exact range, so one range all day is one cache row per
  // listing per day, refreshed in place, instead of a new row every 15m.
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS
  return {
    subject_refs: listings,
    range: {
      start: new Date(today - LOOKBACK_DAYS * DAY_MS).toISOString(),
      end: new Date(today + DAY_MS).toISOString(),
    },
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
    if (Date.parse(bars[i].ts) - Date.parse(bars[i - 1].ts) > SESSION_GAP_MS) start = i
  }
  return bars.slice(start)
}

export function sparklineClosesByListing(
  response: GetSeriesResponse,
): Map<string, ReadonlyArray<number>> {
  const map = new Map<string, ReadonlyArray<number>>()
  for (const entry of response.results) {
    if (entry.outcome.outcome !== 'available') continue
    const closes = latestSessionBars(entry.outcome.data.bars).map((bar) => bar.close)
    // One close draws no line; leaving it out marks the batch incomplete, so
    // it is retried instead of cached as a blank row.
    if (closes.length >= 2) map.set(entry.listing.id, closes)
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
