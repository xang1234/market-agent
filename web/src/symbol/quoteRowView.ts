// Pure projection from a fetched-quote state to the row's display fields.
// Lives in its own .ts module (no JSX) so node:test can import it directly.
// `<QuoteRow>` is a thin renderer over this projection; both watchlist and
// held surfaces flow through it, which is what pins down the cw0.10.1
// "same subject renders identical values" verification.

import {
  formatQuotePrice,
  formatSignedPercent,
  quoteDirection,
  type QuoteDirection,
  type QuoteSnapshot,
} from './quote.ts'
import { symbolDetailPathForSubject, type SubjectRef } from './search.ts'
import type { VisibleFetchState } from './useFetched.ts'

export type QuoteRowState = VisibleFetchState<QuoteSnapshot>

export type QuoteRowView = {
  href: string
  primary: string
  secondary: string
  price: { text: string; direction: QuoteDirection; percent: string; freshness: string } | null
}

export function quoteRowView(state: QuoteRowState, subjectRef: SubjectRef): QuoteRowView {
  const href = symbolDetailPathForSubject(subjectRef)

  if (state.status === 'ready') {
    const quote = state.data
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

  return {
    href,
    primary: state.status === 'loading' ? 'Loading…' : truncateId(subjectRef.id),
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
