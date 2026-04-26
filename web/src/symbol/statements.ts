import type { SubjectRef } from './search.ts'

export type StatementFamily = 'income' | 'balance' | 'cashflow'

export type StatementBasis = 'as_reported' | 'as_restated'

export type FiscalPeriod = 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4'

export type StatementCoverageLevel = 'full' | 'partial' | 'sparse' | 'unavailable'

export type StatementLine = {
  metric_key: string
  value_num: number | null
  value_text?: string
  unit: string
  currency?: string
  scale: number
  coverage_level: StatementCoverageLevel
}

export type NormalizedStatement = {
  subject: SubjectRef & { kind: 'issuer' }
  family: StatementFamily
  basis: StatementBasis
  period_kind: 'point' | 'fiscal_q' | 'fiscal_y' | 'ttm'
  period_start: string | null
  period_end: string
  fiscal_year: number
  fiscal_period: FiscalPeriod
  reporting_currency: string
  as_of: string
  reported_at: string | null
  source_id: string
  lines: ReadonlyArray<StatementLine>
}

export type AvailabilityReason =
  | 'provider_error'
  | 'missing_coverage'
  | 'rate_limited'
  | 'stale_data'

export type StatementOutcome =
  | { outcome: 'available'; data: NormalizedStatement }
  | {
      outcome: 'unavailable'
      reason: AvailabilityReason
      subject: SubjectRef & { kind: 'issuer' }
      source_id: string
      as_of: string
      retryable: boolean
      detail?: string
    }

export type StatementResultEntry = {
  period: string
  outcome: StatementOutcome
}

export type GetStatementsRequest = {
  subject_ref: SubjectRef & { kind: 'issuer' }
  statement: StatementFamily
  periods: string[]
  basis: StatementBasis
}

export type GetStatementsResponse = {
  query: GetStatementsRequest
  results: ReadonlyArray<StatementResultEntry>
}

export class StatementsFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'StatementsFetchError'
    this.status = status
  }
}

type FetchImpl = typeof fetch

const FUNDAMENTALS_API_BASE = '/v1/fundamentals'

export async function fetchStatements(
  query: GetStatementsRequest,
  init: { signal?: AbortSignal; fetchImpl?: FetchImpl } = {},
): Promise<GetStatementsResponse> {
  const fetchFn = init.fetchImpl ?? fetch
  const res = await fetchFn(`${FUNDAMENTALS_API_BASE}/statements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(query),
    signal: init.signal,
  })
  if (!res.ok) {
    throw new StatementsFetchError(res.status, `fundamentals statements fetch failed: HTTP ${res.status}`)
  }
  return (await res.json()) as GetStatementsResponse
}

export function recentFyPeriods(latestFiscalYear: number, count: number): string[] {
  const periods: string[] = []
  for (let i = 0; i < count; i++) {
    periods.push(`${latestFiscalYear - i}-FY`)
  }
  return periods
}

export function findLineValue(
  statement: Pick<NormalizedStatement, 'lines'> | null | undefined,
  metric_key: string,
): number | null {
  if (!statement) return null
  const line = statement.lines.find((l) => l.metric_key === metric_key)
  if (!line || line.value_num === null) return null
  return line.value_num * line.scale
}
