import {
  displaySubjectRef,
  type IssuerContext,
  type ListingContext,
  type ResolvedSubject,
  type SubjectRef,
} from './search.ts'

export type { ResolvedSubject }

export type QuoteDelayClass = 'realtime' | 'delayed' | 'eod'
export type QuoteSessionState = 'pre_market' | 'regular' | 'after_hours' | 'closed'
export type QuoteDirection = 'up' | 'down' | 'flat'

export type QuoteSnapshot = {
  subject_ref: SubjectRef
  display_name: string
  listing: {
    ticker: string
    mic: string
    timezone: string
  }
  latest_price: number
  absolute_move: number
  percent_move: number
  currency: string
  as_of: string
  delay_class: QuoteDelayClass
  session_state: QuoteSessionState
  source_id: string
  recent_range: number[]
  issuer_profile?: {
    legal_name: string
    sector?: string
    industry?: string
  }
}

const STUB_AS_OF = '2026-04-24T14:45:00.000Z'
const STUB_SOURCE_ID = 'p1.1-stub'

export function createQuoteSnapshotStub(subject: ResolvedSubject): QuoteSnapshot {
  const listing = listingForSubject(subject)
  const seed = stableSeed(`${listing.ticker}:${listing.mic}:${subject.subject_ref.id}`)
  const basePrice = listing.ticker === 'AAPL' ? 196.58 : 40 + (seed % 24_000) / 100
  const absoluteMove = listing.ticker === 'AAPL' ? 1.24 : ((seed % 900) - 450) / 100
  const previousClose = basePrice - absoluteMove
  const percentMove = previousClose === 0 ? 0 : (absoluteMove / previousClose) * 100

  return {
    subject_ref: subject.subject_ref,
    display_name: subject.display_label ?? subject.display_name,
    listing: {
      ticker: listing.ticker,
      mic: listing.mic,
      timezone: listing.timezone,
    },
    latest_price: roundMoney(basePrice),
    absolute_move: roundMoney(absoluteMove),
    percent_move: roundPercent(percentMove),
    currency: listing.trading_currency,
    as_of: STUB_AS_OF,
    delay_class: 'delayed',
    session_state: 'regular',
    source_id: STUB_SOURCE_ID,
    recent_range: recentRange(basePrice, absoluteMove),
    ...(subject.context?.issuer ? { issuer_profile: issuerProfile(subject.context.issuer) } : {}),
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

function listingForSubject(subject: ResolvedSubject): ListingContext {
  const listing = subject.context?.listing ?? subject.context?.active_listings?.[0]
  if (listing) return listing

  const ticker =
    subject.display_labels?.ticker ??
    (subject.subject_ref.kind === 'listing' ? subject.display_name.split(/\s+/)[0] : 'N/A')

  return {
    subject_ref: {
      kind: 'listing',
      id: subject.subject_ref.id,
    },
    instrument_ref: {
      kind: 'instrument',
      id: 'p1.1-stub-instrument',
    },
    issuer_ref: {
      kind: 'issuer',
      id: 'p1.1-stub-issuer',
    },
    mic: subject.display_labels?.mic ?? 'XNAS',
    ticker: ticker.toUpperCase(),
    trading_currency: 'USD',
    timezone: 'America/New_York',
  }
}

function issuerProfile(issuer: IssuerContext): QuoteSnapshot['issuer_profile'] {
  return {
    legal_name: issuer.legal_name,
    ...(issuer.sector ? { sector: issuer.sector } : {}),
    ...(issuer.industry ? { industry: issuer.industry } : {}),
  }
}

function recentRange(basePrice: number, absoluteMove: number): number[] {
  const step = Math.max(Math.abs(absoluteMove), basePrice * 0.002)
  return [-2.2, -1.1, -1.5, -0.2, 0.4, 0.1, 1].map((offset) =>
    roundMoney(basePrice + offset * step),
  )
}

function stableSeed(input: string): number {
  let hash = 0
  for (const char of input) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100
}

export function subjectDisplayName(subject: ResolvedSubject): string {
  return (
    subject.display_labels?.primary ??
    subject.display_label ??
    subject.display_name ??
    displaySubjectRef(subject.subject_ref)
  )
}
