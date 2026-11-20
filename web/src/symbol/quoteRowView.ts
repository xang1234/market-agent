// Pure projection from a fetched-quote state to the row's display fields.
// Lives in its own .ts module (no JSX) so node:test can import it directly.
// `<QuoteRow>` is a thin renderer over this projection; both watchlist and
// held surfaces flow through it, which is what pins down the cw0.10.1
// "same subject renders identical values" verification.

import {
  formatQuotePrice,
  formatSignedPercent,
  quoteDirection,
  subjectDisplayName,
  UNKNOWN_SYMBOL,
  UNNAMED_SYMBOL,
  type QuoteDirection,
  type QuoteSnapshot,
} from './quote.ts'
import { symbolDetailPathForSubject, type ResolvedSubject, type SubjectRef } from './search.ts'
import type { VisibleFetchState } from '../fetch/resource.ts'
import { readableDate } from '../evidence/readable.ts'

export type QuoteRowState = VisibleFetchState<QuoteSnapshot>

export type QuoteRowView = {
  href: string
  // Null while the name is still loading.
  primary: string | null
  secondary: string
  // The name a control beside the row says it acts on; null while the row has only a placeholder name.
  label: string | null
  price: { text: string; direction: QuoteDirection; percent: string; freshness: string } | null
}

// `subject` names a row that has no ready quote to take its ticker from.
export function quoteRowView(
  state: QuoteRowState,
  subjectRef: SubjectRef,
  subject: VisibleFetchState<ResolvedSubject>,
): QuoteRowView {
  const href = symbolDetailPathForSubject(subjectRef)

  if (state.status === 'ready') {
    const quote = state.data
    return {
      href,
      primary: quote.listing.ticker,
      secondary: `${quote.listing.mic} · ${quote.currency}`,
      label: `${quote.listing.ticker} (${quote.listing.mic}, ${quote.currency})`,
      price: {
        text: formatQuotePrice(quote.latest_price, quote.currency),
        direction: quoteDirection(quote),
        percent: formatSignedPercent(quote.percent_move),
        freshness: freshnessLabel(quote),
      },
    }
  }

  if (state.status === 'loading') return { href, primary: null, secondary: '', label: null, price: null }
  const name = subject.status === 'ready' ? subjectDisplayName(subject.data) : null
  const mic = subject.status === 'ready' ? subject.data.display_labels?.mic : undefined
  return {
    href,
    primary: name ?? placeholderName(subject),
    secondary: state.status === 'idle' ? 'No quote' : 'Quote unavailable',
    // The resolver's listing name already reads "TICKER · MIC — Name".
    label: name !== null && mic && !name.includes(mic) ? `${name} (${mic})` : name,
    price: null,
  }
}

// A failed lookup says nothing about the symbol, so it gets a neutral name, not "Unknown symbol".
function placeholderName(subject: VisibleFetchState<ResolvedSubject>): string | null {
  if (subject.status === 'ready') return UNKNOWN_SYMBOL
  return subject.status === 'unavailable' ? UNNAMED_SYMBOL : null
}

function freshnessLabel(quote: QuoteSnapshot): string {
  return `${quote.session_state.replaceAll('_', ' ')} · ${quote.delay_class.replaceAll('_', ' ')} · ${readableDate(quote.as_of)}`
}
