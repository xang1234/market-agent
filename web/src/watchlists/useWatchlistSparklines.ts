import { useResource } from '../fetch/resource.ts'
import type { SubjectRef } from '../symbol/search.ts'
import { watchlistSparklines } from './watchlistSparklines.ts'

const EMPTY: Map<string, ReadonlyArray<number>> = new Map()

export function useWatchlistSparklines(
  members: ReadonlyArray<SubjectRef>,
): Map<string, ReadonlyArray<number>> {
  const listingIds = [
    ...new Set(members.filter((ref) => ref.kind === 'listing').map((ref) => ref.id)),
  ].sort()
  const state = useResource(watchlistSparklines, listingIds.length === 0 ? null : { listingIds })
  return state.status === 'ready' ? state.data : EMPTY
}
