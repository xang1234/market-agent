// Wire-shape mirror of the screener service's `/v1/screener/search`
// query and response envelopes (see `services/screener/src/query.ts`,
// `services/screener/src/result.ts`). The frontend redeclares the
// shapes rather than importing across the package boundary —
// matching the convention `web/src/symbol/quote.ts` set for the
// market service.
//
// The server is authoritative for every contract invariant
// (closed field registry, clause/dimension matrix, page echo,
// strictly increasing rank, …). This module exists only so the
// UI can construct a valid envelope and decode the response with
// type narrowing — it does NOT re-validate, so a server-side
// contract change must still propagate the type here.

export type SortDirection = 'asc' | 'desc'

export type EnumClause = {
  field: string
  values: ReadonlyArray<string>
}

export type NumericClause = {
  field: string
  min?: number
  max?: number
}

export type ScreenerClause = EnumClause | NumericClause

export type SortSpec = {
  field: string
  direction: SortDirection
}

export type ScreenerPage = {
  limit: number
  offset?: number
}

export type ScreenerQuery = {
  universe: ReadonlyArray<EnumClause>
  market: ReadonlyArray<ScreenerClause>
  fundamentals: ReadonlyArray<NumericClause>
  sort: ReadonlyArray<SortSpec>
  page: ScreenerPage
}

export type ScreenerSubjectKind = 'issuer' | 'instrument' | 'listing'

export type ScreenerSubjectRef = {
  kind: ScreenerSubjectKind
  id: string
}

export type ScreenerDisplay = {
  primary: string
  ticker?: string
  mic?: string
  legal_name?: string
  share_class?: string
}

export type ScreenerQuoteSummary = {
  last_price: number | null
  prev_close: number | null
  change_pct: number | null
  volume: number | null
  delay_class: string
  currency: string
  as_of: string
}

export type ScreenerFundamentalsSummary = {
  market_cap: number | null
  pe_ratio: number | null
  gross_margin: number | null
  operating_margin: number | null
  net_margin: number | null
  revenue_growth_yoy: number | null
}

export type ScreenerResultRow = {
  subject_ref: ScreenerSubjectRef
  display: ScreenerDisplay
  rank: number
  quote: ScreenerQuoteSummary
  fundamentals: ScreenerFundamentalsSummary
}

export type ScreenerResponse = {
  query: ScreenerQuery
  rows: ReadonlyArray<ScreenerResultRow>
  total_count: number
  page: ScreenerPage
  as_of: string
  snapshot_compatible: boolean
}

// Mirror of the page-size cap enforced by `services/screener/src/query.ts`.
// Used by the limit input; the server still rejects out-of-range values.
export const SCREENER_LIMIT_MIN = 1
export const SCREENER_LIMIT_MAX = 500

// Curated UI roster — the subset of registered fields the workspace
// surfaces today. The full registry lives in
// `services/screener/src/fields.ts` and may grow without forcing this
// file to change. Each entry is paired with a human label and, for
// enum fields, the in-UI option set; the server still validates every
// field name, so an oversight here is a UX gap, not a security gap.

export type UniverseEnumOption = {
  field: 'asset_type' | 'sector' | 'mic'
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
}

export const UNIVERSE_ENUM_FIELDS: ReadonlyArray<UniverseEnumOption> = [
  {
    field: 'asset_type',
    label: 'Asset type',
    options: [
      { value: 'common_stock', label: 'Common stock' },
      { value: 'adr', label: 'ADR' },
      { value: 'etf', label: 'ETF' },
      { value: 'index', label: 'Index' },
    ],
  },
  {
    field: 'sector',
    label: 'Sector',
    options: [
      { value: 'Technology', label: 'Technology' },
      { value: 'Communication Services', label: 'Communication Services' },
      { value: 'Consumer Cyclical', label: 'Consumer Cyclical' },
      { value: 'Financial Services', label: 'Financial Services' },
      { value: 'Healthcare', label: 'Healthcare' },
    ],
  },
  {
    field: 'mic',
    label: 'Venue (MIC)',
    options: [
      { value: 'XNAS', label: 'XNAS · Nasdaq' },
      { value: 'XNYS', label: 'XNYS · NYSE' },
    ],
  },
]

export type NumericRangeField = {
  field: string
  label: string
  hint?: string
  step?: string
}

export const MARKET_NUMERIC_FIELDS: ReadonlyArray<NumericRangeField> = [
  { field: 'last_price', label: 'Last price', step: 'any' },
  { field: 'change_pct', label: 'Change %', hint: 'fractional, e.g. 0.05 = 5%', step: 'any' },
  { field: 'volume', label: 'Volume', step: '1' },
]

export const FUNDAMENTALS_NUMERIC_FIELDS: ReadonlyArray<NumericRangeField> = [
  { field: 'market_cap', label: 'Market cap', step: 'any' },
  { field: 'pe_ratio', label: 'P/E ratio', step: 'any' },
  { field: 'gross_margin', label: 'Gross margin', hint: 'fractional', step: 'any' },
  { field: 'operating_margin', label: 'Operating margin', hint: 'fractional', step: 'any' },
  { field: 'net_margin', label: 'Net margin', hint: 'fractional', step: 'any' },
  { field: 'revenue_growth_yoy', label: 'Revenue YoY', hint: 'fractional', step: 'any' },
]

// Sortable fields surfaced in the UI sort picker. Mirrors the `sortable`
// flag in the service registry; only numeric fields are sortable today.
export const SORTABLE_FIELDS: ReadonlyArray<{ field: string; label: string }> = [
  { field: 'market_cap', label: 'Market cap' },
  { field: 'last_price', label: 'Last price' },
  { field: 'change_pct', label: 'Change %' },
  { field: 'volume', label: 'Volume' },
  { field: 'pe_ratio', label: 'P/E ratio' },
  { field: 'gross_margin', label: 'Gross margin' },
  { field: 'operating_margin', label: 'Operating margin' },
  { field: 'net_margin', label: 'Net margin' },
  { field: 'revenue_growth_yoy', label: 'Revenue YoY' },
]
