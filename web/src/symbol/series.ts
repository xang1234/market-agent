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

// Ranges behind the Overview price-range toggle. 1M preserves the prior fixed
// 30-day window, so the default view is unchanged when no selection is made.
export type PriceWindow = '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y'

// ── Canonical range-label vocabulary ─────────────────────────────────────────
// Single source of truth for "range label → day span" and "label → daily
// series query" across every surface (Overview hero chart, watchlist rail
// sparklines, perf_comparison blocks). YTD deliberately has no table entry —
// it only exists through rangeDays(label, anchor), so it cannot be misread
// as a fixed span.

const FIXED_RANGE_DAYS: Readonly<Record<string, number>> = {
  // 7 calendar days ≈ 5 trading bars.
  '5D': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '5Y': 1825,
}

const DAY_MS = 24 * 60 * 60 * 1000

// Day span for a range label, resolving YTD against `anchor` (min 7 so an
// early-January YTD still has enough bars to draw a line). Null for labels
// outside the vocabulary.
export function rangeDays(label: string, anchor: Date): number | null {
  if (label === 'YTD') {
    const yearStart = Date.UTC(anchor.getUTCFullYear(), 0, 1)
    return Math.max(7, Math.floor((anchor.getTime() - yearStart) / DAY_MS))
  }
  return FIXED_RANGE_DAYS[label] ?? null
}

// One batched daily-bars query for a labeled range ending at `anchor`. The
// anchor is the caller's freshness contract: live surfaces pass `new Date()`,
// sealed blocks pass their pinned as_of so rendering stays deterministic.
export function dailySeriesQuery(
  listings: ReadonlyArray<ListingRef>,
  label: string,
  normalization: SeriesNormalization,
  anchor: Date,
): NormalizedSeriesQuery | null {
  const days = rangeDays(label, anchor)
  if (listings.length === 0 || days === null) return null
  return {
    subject_refs: [...listings],
    range: {
      start: new Date(anchor.getTime() - days * DAY_MS).toISOString(),
      end: anchor.toISOString(),
    },
    interval: '1d',
    basis: 'split_and_div_adjusted',
    normalization,
  }
}

// split_and_div_adjusted is the only basis the market service emits today.
export function windowedDailyQuery(
  listingId: string,
  days: number,
  endIso: string = new Date().toISOString(),
): NormalizedSeriesQuery {
  const endMs = Date.parse(endIso)
  const startMs = endMs - days * 24 * 60 * 60 * 1000
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
