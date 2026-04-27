import type { SubjectRef } from './search.ts'

export type AnalystRating = 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell'

export const ANALYST_RATINGS: ReadonlyArray<AnalystRating> = [
  'strong_buy',
  'buy',
  'hold',
  'sell',
  'strong_sell',
]

export type RatingDistribution = {
  counts: Readonly<Record<AnalystRating, number>>
  contributor_count: number
  as_of: string
  source_id: string
}

export type PriceTarget = {
  currency: string
  low: number
  mean: number
  median: number
  high: number
  contributor_count: number
  as_of: string
  source_id: string
}

export type ConsensusEstimate = {
  metric_key: string
  metric_id: string
  period_kind: string
  period_end: string
  fiscal_year: number
  fiscal_period: string
  contributor_count: number
  mean: number
  median: number
  low: number
  high: number
  std_dev?: number
  unit: string
  currency?: string
  as_of: string
  source_id: string
}

export type AnalystConsensusEnvelope = {
  subject: SubjectRef & { kind: 'issuer' }
  family: 'analyst_consensus'
  analyst_count: number
  as_of: string
  rating_distribution: RatingDistribution | null
  price_target: PriceTarget | null
  estimates: ReadonlyArray<ConsensusEstimate>
  coverage_warnings: ReadonlyArray<{ code: string; message: string }>
}

type WireGetConsensusResponse = {
  consensus: AnalystConsensusEnvelope
}

export class ConsensusFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ConsensusFetchError'
    this.status = status
  }
}

type FetchImpl = typeof fetch

const FUNDAMENTALS_API_BASE = '/v1/fundamentals'

export async function fetchConsensus(
  issuerId: string,
  init: { signal?: AbortSignal; fetchImpl?: FetchImpl } = {},
): Promise<AnalystConsensusEnvelope> {
  const fetchFn = init.fetchImpl ?? fetch
  const url = `${FUNDAMENTALS_API_BASE}/consensus?subject_kind=issuer&subject_id=${encodeURIComponent(issuerId)}`
  const res = await fetchFn(url, { signal: init.signal })
  if (!res.ok) {
    throw new ConsensusFetchError(res.status, `fundamentals consensus fetch failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as WireGetConsensusResponse
  return body.consensus
}

export function consensusBelongsToIssuer(
  envelope: Pick<AnalystConsensusEnvelope, 'subject'>,
  issuerId: string | null,
): boolean {
  return issuerId !== null && envelope.subject.kind === 'issuer' && envelope.subject.id === issuerId
}

const RATING_LABELS: Readonly<Record<AnalystRating, string>> = {
  strong_buy: 'Strong buy',
  buy: 'Buy',
  hold: 'Hold',
  sell: 'Sell',
  strong_sell: 'Strong sell',
}

export function ratingLabel(rating: AnalystRating): string {
  return RATING_LABELS[rating]
}
