// Pure projection from per-row fetch state to display fields.
//
// Lives in its own .ts module (no JSX) so the node:test harness — which
// runs with `--experimental-strip-types` and can't process .tsx — can
// import the pure view directly. The shared component in QuoteRow.tsx
// is a thin renderer over this projection; both watchlist and held
// surfaces flow through it, which is what the cw0.10.1 verification
// "same subject renders identical values" actually pins down.

import {
  formatQuotePrice,
  formatSignedPercent,
  quoteBelongsToListing,
  quoteDirection,
  type QuoteDirection,
  type QuoteSnapshot,
} from './quote.ts'
import { symbolDetailPathForSubject, type SubjectRef } from './search.ts'

export type QuoteRowFetchState =
  | { status: 'idle' }
  | { status: 'unavailable'; listingId: string }
  | { status: 'ready'; listingId: string; quote: QuoteSnapshot }

export type QuoteRowView = {
  href: string
  primary: string
  secondary: string
  price: { text: string; direction: QuoteDirection; percent: string; freshness: string } | null
}

export function quoteRowView(
  state: QuoteRowFetchState,
  subjectRef: SubjectRef,
): QuoteRowView {
  const href = symbolDetailPathForSubject(subjectRef)
  const listingId = subjectRef.kind === 'listing' ? subjectRef.id : null

  if (
    state.status === 'ready' &&
    listingId !== null &&
    state.listingId === listingId &&
    quoteBelongsToListing(state.quote, listingId)
  ) {
    const { quote } = state
    return {
      href,
      primary: quote.listing.ticker,
      secondary: `${quote.listing.mic} · ${quote.currency}`,
      price: {
        text: formatQuotePrice(quote.latest_price, quote.currency),
        direction: quoteDirection(quote),
        percent: formatSignedPercent(quote.percent_move),
        freshness: freshnessLabel(quote),
      },
    }
  }

  const isLoading =
    listingId !== null &&
    !(state.status === 'unavailable' && state.listingId === listingId)

  return {
    href,
    primary: isLoading ? 'Loading…' : truncateId(subjectRef.id),
    secondary: subjectRef.kind,
    price: null,
  }
}

function freshnessLabel(quote: QuoteSnapshot): string {
  return `${quote.session_state.replaceAll('_', ' ')} · ${quote.delay_class.replaceAll('_', ' ')} · ${quote.as_of}`
}

function truncateId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`
}
