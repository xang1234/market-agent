// Single quote fetch for an entered subject, shared by the header
// (QuoteSnapshot) and the Overview key-stats grid via the subject-detail
// outlet context — so prev close / currency come from the authoritative quote
// once, not a second fetch or a bars-derived approximation. A thin wrapper over
// the canonical useFetched: keyed by listingId, aborts on change, collapses a
// stale key to 'loading'.

import {
  fetchQuoteSnapshot,
  quoteBelongsToListing,
  type QuoteSnapshot as QuoteSnapshotData,
} from './quote.ts'
import { useFetched, type VisibleFetchState } from './useFetched.ts'

export type SubjectQuoteState = VisibleFetchState<QuoteSnapshotData>

export function useSubjectQuote(listingId: string | null): SubjectQuoteState {
  return useFetched(listingId, async (id, signal) => {
    const quote = await fetchQuoteSnapshot(id, { signal })
    return quoteBelongsToListing(quote, id)
      ? { kind: 'ready', data: quote }
      : { kind: 'unavailable', reason: 'quote response did not match requested listing' }
  })
}
