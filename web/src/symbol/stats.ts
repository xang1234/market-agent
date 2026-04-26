import type { SubjectRef } from './search.ts'

export type KeyStatKey =
  | 'gross_margin'
  | 'operating_margin'
  | 'net_margin'
  | 'revenue_growth_yoy'
  | 'pe_ratio'

export type KeyStatUnit = 'ratio' | 'multiple'
export type KeyStatFormatHint = 'percent' | 'multiple'
export type KeyStatCoverageLevel = 'full' | 'partial' | 'sparse' | 'unavailable'

export type KeyStatWarningCode =
  | 'missing_statement_line'
  | 'missing_market_price'
  | 'null_statement_value'
  | 'zero_denominator'
  | 'currency_mismatch'
  | 'coverage_incomplete'
  | 'input_mismatch'
  | 'stale_input'

export type KeyStatWarning = {
  code: KeyStatWarningCode
  message: string
}

export type KeyStat = {
  stat_key: KeyStatKey
  value_num: number | null
  unit: KeyStatUnit
  format_hint: KeyStatFormatHint
  coverage_level: KeyStatCoverageLevel
  basis: string
  period_kind: string
  period_start: string | null
  period_end: string
  fiscal_year: number
  fiscal_period: string
  as_of: string
  computation: { kind: string; expression: string }
  inputs: ReadonlyArray<unknown>
  warnings: ReadonlyArray<KeyStatWarning>
}

export type KeyStatsEnvelope = {
  subject: SubjectRef & { kind: 'issuer' }
  family: 'key_stats'
  basis: string
  period_kind: string
  period_start: string | null
  period_end: string
  fiscal_year: number
  fiscal_period: string
  reporting_currency: string
  as_of: string
  stats: ReadonlyArray<KeyStat>
}

type WireGetStatsResponse = {
  stats: KeyStatsEnvelope
}

export class StatsFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'StatsFetchError'
    this.status = status
  }
}

type FetchImpl = typeof fetch

const FUNDAMENTALS_API_BASE = '/v1/fundamentals'

export async function fetchKeyStats(
  issuerId: string,
  init: { signal?: AbortSignal; fetchImpl?: FetchImpl } = {},
): Promise<KeyStatsEnvelope> {
  const fetchFn = init.fetchImpl ?? fetch
  const url = `${FUNDAMENTALS_API_BASE}/stats?subject_kind=issuer&subject_id=${encodeURIComponent(issuerId)}`
  const res = await fetchFn(url, { signal: init.signal })
  if (!res.ok) {
    throw new StatsFetchError(res.status, `fundamentals stats fetch failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as WireGetStatsResponse
  return body.stats
}

export function statsBelongToIssuer(
  envelope: Pick<KeyStatsEnvelope, 'subject'>,
  issuerId: string | null,
): boolean {
  return issuerId !== null && envelope.subject.kind === 'issuer' && envelope.subject.id === issuerId
}

const STAT_LABELS: Readonly<Record<KeyStatKey, string>> = {
  gross_margin: 'Gross margin',
  operating_margin: 'Operating margin',
  net_margin: 'Net margin',
  revenue_growth_yoy: 'Revenue growth (YoY)',
  pe_ratio: 'P/E (diluted)',
}

export function statLabel(key: KeyStatKey): string {
  return STAT_LABELS[key]
}

export function formatStatValue(stat: Pick<KeyStat, 'value_num' | 'format_hint'>): string {
  if (stat.value_num === null) return '—'
  if (stat.format_hint === 'percent') {
    return `${(stat.value_num * 100).toFixed(2)}%`
  }
  return `${stat.value_num.toFixed(2)}×`
}
