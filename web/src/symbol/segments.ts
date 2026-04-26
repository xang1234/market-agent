import type { SubjectRef } from './search.ts'
import type { FiscalPeriod, StatementBasis } from './statements.ts'

export type SegmentAxis = 'business' | 'geography'

export type SegmentDefinition = {
  segment_id: string
  segment_name: string
  parent_segment_id?: string
  description?: string
  definition_as_of: string
}

export type SegmentCoverageWarningCode =
  | 'fact_without_definition'
  | 'definition_without_fact'
  | 'duplicate_segment_metric'
  | 'currency_mismatch'
  | 'null_segment_value'
  | 'coverage_incomplete'
  | 'reconciliation_gap'
  | 'stale_segment_definition'
  | 'unknown_parent_segment'

export type SegmentCoverageWarning = {
  code: SegmentCoverageWarningCode
  message: string
  segment_id?: string
  metric_key?: string
}

export type SegmentFact = {
  segment_id: string
  metric_key: string
  metric_id: string
  value_num: number | null
  unit: string
  currency?: string
  coverage_level: 'full' | 'partial' | 'sparse' | 'unavailable'
  source_id: string
  as_of: string
}

export type SegmentFactsEnvelope = {
  subject: SubjectRef & { kind: 'issuer' }
  family: 'segment_facts'
  axis: SegmentAxis
  basis: StatementBasis
  period_kind: string
  period_start: string
  period_end: string
  fiscal_year: number
  fiscal_period: FiscalPeriod
  reporting_currency: string
  as_of: string
  segment_definitions: ReadonlyArray<SegmentDefinition>
  facts: ReadonlyArray<SegmentFact>
  coverage_warnings: ReadonlyArray<SegmentCoverageWarning>
}

export type GetSegmentsRequest = {
  subject_ref: SubjectRef & { kind: 'issuer' }
  axis: SegmentAxis
  period: string
  basis: StatementBasis
}

export type GetSegmentsResponse = {
  segments: SegmentFactsEnvelope
}

export class SegmentsFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'SegmentsFetchError'
    this.status = status
  }
}

type FetchImpl = typeof fetch

const FUNDAMENTALS_API_BASE = '/v1/fundamentals'

export async function fetchSegments(
  query: GetSegmentsRequest,
  init: { signal?: AbortSignal; fetchImpl?: FetchImpl } = {},
): Promise<SegmentFactsEnvelope> {
  const fetchFn = init.fetchImpl ?? fetch
  const res = await fetchFn(`${FUNDAMENTALS_API_BASE}/segments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(query),
    signal: init.signal,
  })
  if (!res.ok) {
    throw new SegmentsFetchError(res.status, `fundamentals segments fetch failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as GetSegmentsResponse
  return body.segments
}

// Sums the named metric across an envelope's facts. Skips segments whose
// value_num is null (so a sparse disclosure can't fabricate an inflated
// total). Used as the donut total when the wire envelope doesn't ship a
// consolidated_totals echo.
export function sumSegmentMetric(
  envelope: Pick<SegmentFactsEnvelope, 'facts'>,
  metric_key: string,
): number {
  let total = 0
  for (const fact of envelope.facts) {
    if (fact.metric_key !== metric_key) continue
    if (fact.value_num === null) continue
    total += fact.value_num
  }
  return total
}

const AXIS_LABELS: Readonly<Record<SegmentAxis, string>> = {
  business: 'Business',
  geography: 'Geography',
}

export function axisLabel(axis: SegmentAxis): string {
  return AXIS_LABELS[axis]
}
