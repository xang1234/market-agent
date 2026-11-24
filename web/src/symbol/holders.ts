import type { SubjectRef } from './search.ts'
import { defineResource, type FetchedResult } from '../fetch/resource.ts'
import { notOnFileError } from './fundamentalsNotOnFile.ts'

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
  // null when not computable (e.g. SEC 13F, which has no ownership percentage)
  percent_of_shares_outstanding: number | null
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
    throw (await notOnFileError(res)) ?? new HoldersFetchError(res.status, `fundamentals holders fetch failed: HTTP ${res.status}`)
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

export const institutionalHolders = defineResource({
  freshness: 'filed',
  load: (issuerId: string, signal) => loadHolders(issuerId, 'institutional', isInstitutionalHolders, signal),
})

export const insiderHolders = defineResource({
  freshness: 'filed',
  load: (issuerId: string, signal) => loadHolders(issuerId, 'insider', isInsiderHolders, signal),
})

async function loadHolders<E extends HoldersEnvelope>(
  issuerId: string,
  kind: E['kind'],
  narrow: (envelope: HoldersEnvelope) => envelope is E,
  signal: AbortSignal,
): Promise<FetchedResult<E>> {
  const data = await fetchHolders(issuerId, kind, { signal })
  if (!holdersBelongToIssuer(data, issuerId)) {
    return { kind: 'unavailable', reason: 'holders response did not match requested issuer' }
  }
  if (!narrow(data)) {
    return { kind: 'unavailable', reason: `expected ${kind} kind, received ${data.kind}` }
  }
  return { kind: 'ready', data }
}
