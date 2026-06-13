// Single quote fetch for an entered subject, shared by the header
// (QuoteSnapshot) and the Overview key-stats grid via the subject-detail
// outlet context — so prev close / currency come from the authoritative quote
// once, not a second fetch or a bars-derived approximation.

import { useEffect, useState } from 'react'

import {
  fetchQuoteSnapshot,
  quoteBelongsToListing,
  type QuoteSnapshot as QuoteSnapshotData,
} from './quote.ts'

type FetchState =
  | { status: 'idle' }
  | { status: 'unavailable'; listingId: string; reason: string }
  | { status: 'ready'; listingId: string; quote: QuoteSnapshotData }

export type VisibleQuoteState =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'ready'; quote: QuoteSnapshotData }

export function useSubjectQuote(listingId: string | null): VisibleQuoteState {
  const [state, setState] = useState<FetchState>({ status: 'idle' })

  useEffect(() => {
    if (!listingId) return
    const controller = new AbortController()
    fetchQuoteSnapshot(listingId, { signal: controller.signal })
      .then((quote) => {
        if (controller.signal.aborted) return
        if (!quoteBelongsToListing(quote, listingId)) {
          setState({
            status: 'unavailable',
            listingId,
            reason: 'quote response did not match requested listing',
          })
          return
        }
        setState({ status: 'ready', listingId, quote })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({
          status: 'unavailable',
          listingId,
          reason: err instanceof Error ? err.message : 'quote fetch failed',
        })
      })
    return () => controller.abort()
  }, [listingId])

  return visibleQuoteState(state, listingId)
}

// `listingId` on stored states discriminates "current fetch" from "stale
// carryover"; a mismatched key collapses to 'loading'.
function visibleQuoteState(state: FetchState, listingId: string | null): VisibleQuoteState {
  if (!listingId) {
    return { status: 'unavailable', reason: 'no listing context for this subject' }
  }
  if (
    state.status === 'ready' &&
    state.listingId === listingId &&
    quoteBelongsToListing(state.quote, listingId)
  ) {
    return { status: 'ready', quote: state.quote }
  }
  if (state.status === 'unavailable' && state.listingId === listingId) {
    return { status: 'unavailable', reason: state.reason }
  }
  return { status: 'loading' }
}
