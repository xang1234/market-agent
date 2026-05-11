import {
  displaySubjectRef,
  isCanonicalResolvedSubject,
  isSubjectRef,
  type IssuerContext,
  type ListingContext,
  type ResolvedSubject,
  type RouteResolvedSubject,
  type SubjectRef,
} from './search.ts'

export type { ResolvedSubject, RouteResolvedSubject }

// Aligned with services/market/src/quote.ts so the frontend speaks the same
// vocabulary as the spec §6.2.1 quote contract.
export type QuoteDelayClass = 'real_time' | 'delayed_15m' | 'eod' | 'unknown'
export type QuoteSessionState = 'pre_market' | 'regular' | 'post_market' | 'closed'
export type QuoteDirection = 'up' | 'down' | 'flat'

export type QuoteSnapshot = {
  subject_ref: SubjectRef
  listing: {
    ticker: string
    mic: string
    timezone: string
  }
  latest_price: number
  prev_close: number
  absolute_move: number
  percent_move: number
  currency: string
  as_of: string
  delay_class: QuoteDelayClass
  session_state: QuoteSessionState
  source_id: string
}

// Mirrors GetQuoteResponse in services/market/src/http.ts. We type the wire
// shape narrowly so callers see decode failures up front instead of seeing
// `undefined` propagate through the UI.
type WireNormalizedQuote = {
  listing: { kind: 'listing'; id: string }
  price: number
  prev_close: number
  change_abs: number
  change_pct: number
  session_state: QuoteSessionState
  as_of: string
  delay_class: QuoteDelayClass
  currency: string
  source_id: string
}

type WireGetQuoteResponse = {
  quote: WireNormalizedQuote
  listing_context: {
    ticker: string
    mic: string
    timezone: string
  }
}

export class QuoteFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'QuoteFetchError'
    this.status = status
  }
}

type FetchImpl = typeof fetch

const MARKET_API_BASE = '/v1/market'

// Resolves the listing-kind UUID to use for a quote fetch. For a listing-kind
// subject, the subject_ref.id is the listing UUID directly. For an issuer-
// kind subject with hydrated active_listings, we use the first active
// listing. Anything else (issuer without context, instrument, etc.) returns
// null — the caller must surface a "quote unavailable" UI rather than guess.
export function listingIdForQuote(subject: ResolvedSubject | RouteResolvedSubject): string | null {
  if (subject.subject_ref.kind === 'listing') {
    return isSubjectRef(subject.subject_ref) ? subject.subject_ref.id : null
  }
  if (!isCanonicalResolvedSubject(subject)) return null
  const listing =
    subject.context?.listing ?? subject.context?.active_listings?.[0]
  return listing && isSubjectRef(listing.subject_ref) ? listing.subject_ref.id : null
}

// Async quote fetch from the market service. Returns a normalized snapshot
// the UI can render directly. Display-only fields (issuer profile, headline
// name) live on the ResolvedSubject the caller already holds — keeping the
// quote envelope strictly market data avoids re-deriving subject identity in
// two places.
export async function fetchQuoteSnapshot(
  listingId: string,
  init: { signal?: AbortSignal; fetchImpl?: FetchImpl } = {},
): Promise<QuoteSnapshot> {
  const fetchFn = init.fetchImpl ?? fetch
  const url = `${MARKET_API_BASE}/quote?subject_kind=listing&subject_id=${encodeURIComponent(listingId)}`
  const res = await fetchFn(url, { signal: init.signal })
  if (!res.ok) {
    throw new QuoteFetchError(res.status, await quoteErrorMessage(res))
  }
  const body = (await res.json()) as WireGetQuoteResponse
  return snapshotFromWire(body)
}

async function quoteErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    const detail = unavailableDetail(body)
    if (detail) return `market quote fetch failed: ${detail}`
  } catch {
    // Fall through to the stable HTTP-status message when the body is absent
    // or not JSON.
  }
  return `market quote fetch failed: HTTP ${res.status}`
}

function unavailableDetail(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null
  const unavailable = (body as { unavailable?: unknown }).unavailable
  if (unavailable === null || typeof unavailable !== 'object') return null
  const detail = (unavailable as { detail?: unknown }).detail
  return typeof detail === 'string' && detail.length > 0 ? detail : null
}

export function snapshotFromWire(body: WireGetQuoteResponse): QuoteSnapshot {
  const { quote, listing_context } = body
  return {
    subject_ref: { kind: 'listing', id: quote.listing.id },
    listing: { ...listing_context },
    latest_price: quote.price,
    prev_close: quote.prev_close,
    absolute_move: quote.change_abs,
    percent_move: quote.change_pct * 100,
    currency: quote.currency,
    as_of: quote.as_of,
    delay_class: quote.delay_class,
    session_state: quote.session_state,
    source_id: quote.source_id,
  }
}

export function formatSignedNumber(value: number): string {
  if (Object.is(value, -0) || value === 0) return '0.00'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}

export function formatSignedPercent(value: number): string {
  if (Object.is(value, -0) || value === 0) return '0.00%'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

export function formatQuotePrice(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function quoteDirection(quote: Pick<QuoteSnapshot, 'absolute_move'>): QuoteDirection {
  if (quote.absolute_move > 0) return 'up'
  if (quote.absolute_move < 0) return 'down'
  return 'flat'
}

export function quoteBelongsToListing(
  quote: Pick<QuoteSnapshot, 'subject_ref'>,
  listingId: string | null,
): boolean {
  return listingId !== null && quote.subject_ref.kind === 'listing' && quote.subject_ref.id === listingId
}

export function issuerProfileFromSubject(
  subject: ResolvedSubject | RouteResolvedSubject,
): { legal_name: string; sector?: string; industry?: string } | null {
  if (!isCanonicalResolvedSubject(subject)) return null
  const issuer = subject.context?.issuer
  if (!issuer) return null
  return {
    legal_name: issuer.legal_name,
    ...(issuer.sector ? { sector: issuer.sector } : {}),
    ...(issuer.industry ? { industry: issuer.industry } : {}),
  }
}

export function subjectDisplayName(subject: ResolvedSubject | RouteResolvedSubject): string {
  return (
    subject.display_labels?.primary ??
    subject.display_label ??
    subject.display_name ??
    (isSubjectRef(subject.subject_ref) ? displaySubjectRef(subject.subject_ref) : subject.subject_ref.ticker.toUpperCase())
  )
}

// Re-export so callers don't need to import from search.ts when they're
// already pulling quote helpers.
export type { IssuerContext, ListingContext }
