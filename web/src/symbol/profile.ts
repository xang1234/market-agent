import type { ResolvedSubject, SubjectRef } from './search.ts'

export type IssuerProfileExchange = {
  listing: SubjectRef & { kind: 'listing' }
  mic: string
  ticker: string
  trading_currency: string
  timezone: string
}

export type IssuerProfile = {
  subject: SubjectRef & { kind: 'issuer' }
  legal_name: string
  former_names: string[]
  cik?: string
  lei?: string
  domicile?: string
  sector?: string
  industry?: string
  exchanges: IssuerProfileExchange[]
  as_of: string
  source_id: string
}

type WireGetProfileResponse = {
  profile: IssuerProfile
}

export class ProfileFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ProfileFetchError'
    this.status = status
  }
}

type FetchImpl = typeof fetch

const FUNDAMENTALS_API_BASE = '/v1/fundamentals'

// Returns null for a bare listing/instrument subject without resolver
// hydration — caller renders a "context unavailable" message rather than
// guessing the issuer linkage.
export function issuerIdFromSubject(subject: ResolvedSubject): string | null {
  if (subject.subject_ref.kind === 'issuer') return subject.subject_ref.id
  return subject.context?.issuer?.subject_ref.id ?? null
}

export async function fetchIssuerProfile(
  issuerId: string,
  init: { signal?: AbortSignal; fetchImpl?: FetchImpl } = {},
): Promise<IssuerProfile> {
  const fetchFn = init.fetchImpl ?? fetch
  const url = `${FUNDAMENTALS_API_BASE}/profile?subject_kind=issuer&subject_id=${encodeURIComponent(issuerId)}`
  const res = await fetchFn(url, { signal: init.signal })
  if (!res.ok) {
    throw new ProfileFetchError(res.status, `fundamentals profile fetch failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as WireGetProfileResponse
  return body.profile
}

export function profileBelongsToIssuer(
  profile: Pick<IssuerProfile, 'subject'>,
  issuerId: string | null,
): boolean {
  return issuerId !== null && profile.subject.kind === 'issuer' && profile.subject.id === issuerId
}
