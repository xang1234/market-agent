import type { SubjectRef } from './search.ts'

export const HOLDER_KINDS = ['institutional', 'insider'] as const
export type HolderKind = (typeof HOLDER_KINDS)[number]

export const INSIDER_TRANSACTION_TYPES = [
  'buy',
  'sell',
  'option_exercise',
  'gift',
  'other',
] as const
export type InsiderTransactionType = (typeof INSIDER_TRANSACTION_TYPES)[number]

export type InstitutionalHolder = {
  holder_name: string
  shares_held: number
  market_value: number
  percent_of_shares_outstanding: number
  shares_change: number
  filing_date: string
}

export type InsiderTransaction = {
  insider_name: string
  insider_role: string
  transaction_date: string
  transaction_type: InsiderTransactionType
  shares: number
  price: number | null
  value: number | null
}

export type InstitutionalHoldersEnvelope = {
  subject: SubjectRef & { kind: 'issuer' }
  family: 'holders'
  kind: 'institutional'
  currency: string
  holders: ReadonlyArray<InstitutionalHolder>
  as_of: string
  source_id: string
}

export type InsiderHoldersEnvelope = {
  subject: SubjectRef & { kind: 'issuer' }
  family: 'holders'
  kind: 'insider'
  currency: string
  holders: ReadonlyArray<InsiderTransaction>
  as_of: string
  source_id: string
}

export type HoldersEnvelope = InstitutionalHoldersEnvelope | InsiderHoldersEnvelope

type WireGetHoldersResponse = {
  holders: HoldersEnvelope
}

export class HoldersFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HoldersFetchError'
    this.status = status
  }
}

type FetchImpl = typeof fetch

const FUNDAMENTALS_API_BASE = '/v1/fundamentals'

export async function fetchHolders(
  issuerId: string,
  kind: HolderKind,
  init: { signal?: AbortSignal; fetchImpl?: FetchImpl } = {},
): Promise<HoldersEnvelope> {
  const fetchFn = init.fetchImpl ?? fetch
  const url =
    `${FUNDAMENTALS_API_BASE}/holders` +
    `?subject_kind=issuer&subject_id=${encodeURIComponent(issuerId)}` +
    `&kind=${encodeURIComponent(kind)}`
  const res = await fetchFn(url, { signal: init.signal })
  if (!res.ok) {
    throw new HoldersFetchError(res.status, `fundamentals holders fetch failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as WireGetHoldersResponse
  return body.holders
}

export function holdersBelongToIssuer(
  envelope: Pick<HoldersEnvelope, 'subject'>,
  issuerId: string | null,
): boolean {
  return issuerId !== null && envelope.subject.kind === 'issuer' && envelope.subject.id === issuerId
}

export function isInstitutionalHolders(
  envelope: HoldersEnvelope,
): envelope is InstitutionalHoldersEnvelope {
  return envelope.kind === 'institutional'
}

export function isInsiderHolders(
  envelope: HoldersEnvelope,
): envelope is InsiderHoldersEnvelope {
  return envelope.kind === 'insider'
}

const INSIDER_TRANSACTION_LABELS: Readonly<Record<InsiderTransactionType, string>> = {
  buy: 'Buy',
  sell: 'Sell',
  option_exercise: 'Option exercise',
  gift: 'Gift',
  other: 'Other',
}

export function insiderTransactionLabel(type: InsiderTransactionType): string {
  return INSIDER_TRANSACTION_LABELS[type]
}
