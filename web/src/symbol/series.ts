import type { SubjectRef } from './search.ts'

export type BarInterval = '1m' | '5m' | '15m' | '1h' | '1d'

export type AdjustmentBasis =
  | 'unadjusted'
  | 'split_adjusted'
  | 'split_and_div_adjusted'

export type SeriesNormalization =
  | 'raw'
  | 'pct_return'
  | 'index_100'
  | 'currency_normalized'

type ListingRef = SubjectRef & { kind: 'listing' }

export type NormalizedSeriesQuery = {
  subject_refs: ListingRef[]
  range: { start: string; end: string }
  interval: BarInterval
  basis: AdjustmentBasis
  normalization: SeriesNormalization
}

export type NormalizedBar = {
  ts: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type NormalizedBars = {
  listing: ListingRef
  interval: BarInterval
  range: { start: string; end: string }
  bars: NormalizedBar[]
  as_of: string
  delay_class: string
  currency: string
  source_id: string
  adjustment_basis: AdjustmentBasis
}

export type AvailabilityReason =
  | 'provider_error'
  | 'missing_coverage'
  | 'rate_limited'
  | 'stale_data'

export type SeriesOutcome =
  | { outcome: 'available'; data: NormalizedBars }
  | {
      outcome: 'unavailable'
      reason: AvailabilityReason
      listing: ListingRef
      source_id: string
      as_of: string
      retryable: boolean
      detail?: string
    }

export type SeriesResultEntry = {
  listing: ListingRef
  outcome: SeriesOutcome
}

export type GetSeriesResponse = {
  query: NormalizedSeriesQuery
  results: ReadonlyArray<SeriesResultEntry>
}

export class SeriesFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'SeriesFetchError'
    this.status = status
  }
}

type FetchImpl = typeof fetch

const MARKET_API_BASE = '/v1/market'

export async function fetchSeries(
  query: NormalizedSeriesQuery,
  init: { signal?: AbortSignal; fetchImpl?: FetchImpl } = {},
): Promise<GetSeriesResponse> {
  const fetchFn = init.fetchImpl ?? fetch
  const res = await fetchFn(`${MARKET_API_BASE}/series`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(query),
    signal: init.signal,
  })
  if (!res.ok) {
    throw new SeriesFetchError(res.status, `market series fetch failed: HTTP ${res.status}`)
  }
  return (await res.json()) as GetSeriesResponse
}

// split_and_div_adjusted is the only basis the market service emits today.
export function recentDailyQuery(
  listingId: string,
  endIso: string = new Date().toISOString(),
): NormalizedSeriesQuery {
  const endMs = Date.parse(endIso)
  const startMs = endMs - 30 * 24 * 60 * 60 * 1000
  return {
    subject_refs: [{ kind: 'listing', id: listingId }],
    range: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
    interval: '1d',
    basis: 'split_and_div_adjusted',
    normalization: 'raw',
  }
}

export function singleListingOutcome(
  response: GetSeriesResponse,
  listingId: string,
): SeriesOutcome | null {
  const entry = response.results.find((r) => r.listing.id === listingId)
  return entry ? entry.outcome : null
}
