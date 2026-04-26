import type { SubjectRef } from './search.ts'

export type EarningsSurpriseDirection = 'beat' | 'miss' | 'inline'

export type EarningsEvent = {
  release_date: string
  period_end: string
  fiscal_year: number
  fiscal_period: string
  eps_actual: number | null
  eps_estimate_at_release: number | null
  surprise_pct: number | null
  surprise_direction: EarningsSurpriseDirection | null
  source_id: string
  as_of: string
}

export type EarningsEventsEnvelope = {
  subject: SubjectRef & { kind: 'issuer' }
  family: 'earnings_events'
  currency: string
  events: ReadonlyArray<EarningsEvent>
  as_of: string
}

type WireGetEarningsResponse = {
  earnings: EarningsEventsEnvelope
}

export class EarningsFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'EarningsFetchError'
    this.status = status
  }
}

type FetchImpl = typeof fetch

const FUNDAMENTALS_API_BASE = '/v1/fundamentals'

export async function fetchEarnings(
  issuerId: string,
  init: { signal?: AbortSignal; fetchImpl?: FetchImpl } = {},
): Promise<EarningsEventsEnvelope> {
  const fetchFn = init.fetchImpl ?? fetch
  const url = `${FUNDAMENTALS_API_BASE}/earnings?subject_kind=issuer&subject_id=${encodeURIComponent(issuerId)}`
  const res = await fetchFn(url, { signal: init.signal })
  if (!res.ok) {
    throw new EarningsFetchError(res.status, `fundamentals earnings fetch failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as WireGetEarningsResponse
  return body.earnings
}

export function earningsBelongToIssuer(
  envelope: Pick<EarningsEventsEnvelope, 'subject'>,
  issuerId: string | null,
): boolean {
  return issuerId !== null && envelope.subject.kind === 'issuer' && envelope.subject.id === issuerId
}
