// One batched series fetch per (membership set, window). Keyed through
// useFetched so a window flip is one intentional re-fetch, aborted fetches
// don't land, and a return to a cached key is not refetched mid-flight.
import { useFetched } from '../symbol/useFetched.ts'
import { fetchSeries } from '../symbol/series.ts'
import type { SubjectRef } from '../symbol/search.ts'
import {
  sparklineClosesByListing,
  watchlistSeriesQuery,
  type WatchlistWindow,
} from './watchlistSparklines.ts'

const EMPTY: Map<string, ReadonlyArray<number>> = new Map()

export function useWatchlistSparklines(
  members: ReadonlyArray<SubjectRef>,
  window: WatchlistWindow,
): Map<string, ReadonlyArray<number>> {
  const listingIds = members
    .filter((ref) => ref.kind === 'listing')
    .map((ref) => ref.id)
    .sort()
    .join(',')
  const key = listingIds === '' ? null : `${window}|${listingIds}`
  const state = useFetched<Map<string, ReadonlyArray<number>>>(key, async (_key, signal) => {
    const query = watchlistSeriesQuery(members, window, new Date())
    if (query === null) return { kind: 'unavailable', reason: 'no listing members' }
    const response = await fetchSeries(query, { signal })
    return { kind: 'ready', data: sparklineClosesByListing(response) }
  })
  return state.status === 'ready' ? state.data : EMPTY
}
