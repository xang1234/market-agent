// Mirrors services/market/src/series-query.ts and the per-listing outcome
// envelope from services/market/src/http.ts. Kept narrow so decode failures
// surface here rather than as undefined deep in the UI.

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

export type NormalizedSeriesQuery = {
  subject_refs: { kind: 'listing'; id: string }[]
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
  listing: { kind: 'listing'; id: string }
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
      listing: { kind: 'listing'; id: string }
      source_id: string
      as_of: string
      retryable: boolean
      detail?: string
    }

export type SeriesResultEntry = {
  listing: { kind: 'listing'; id: string }
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

// Build a query for the small "limited performance" view on the overview tab:
// 30 days of daily bars, raw + split-and-div-adjusted (the only basis the
// market service emits today). `endIso` lets callers (and tests) pin the
// upper bound; defaults to now.
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

// Pulls the single-listing outcome from a series response. The series
// endpoint returns per-listing outcomes inside a 200 — collapsing them to
// "did we get bars" loses the unavailable reason, so callers should switch
// on outcome.outcome rather than treating null as a generic miss.
export function singleListingOutcome(
  response: GetSeriesResponse,
  listingId: string,
): SeriesOutcome | null {
  const entry = response.results.find((r) => r.listing.id === listingId)
  return entry ? entry.outcome : null
}
