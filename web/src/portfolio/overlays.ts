// Client for the portfolio overlays endpoint (services/portfolio §3.16,
// route POST /v1/portfolios/overlays). Returns one entry per requested
// subject_ref with the contributing portfolios; an empty contributions
// list means the user holds no position in that subject.

import type { SubjectKind, SubjectRef } from '../symbol/search.ts'

export const PORTFOLIO_API_BASE = '/v1/portfolios'

const USER_ID_HEADER = 'x-user-id'

// Mirror of HOLDING_SUBJECT_KINDS in services/portfolio/src/holdings.ts.
// Server enforces the same allowlist at the API boundary; this constant
// keeps the web boundary check (`isHeldSubjectRef`) one-line-aligned with
// the server contract.
export const HELD_SUBJECT_KINDS = ['instrument', 'listing'] as const
export type HeldSubjectKind = (typeof HELD_SUBJECT_KINDS)[number]

export type HeldSubjectRef = SubjectRef & { kind: HeldSubjectKind }

export type HeldState = 'open' | 'closed'

export type OverlayContribution = {
  portfolio_id: string
  portfolio_name: string
  base_currency: string
  quantity: number
  cost_basis: number | null
  held_state: HeldState
  opened_at: string | null
  closed_at: string | null
}

export type SubjectOverlay = {
  subject_ref: HeldSubjectRef
  contributions: ReadonlyArray<OverlayContribution>
}

type FetchImpl = typeof fetch

export class PortfolioFetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'PortfolioFetchError'
    this.status = status
  }
}

export function isHeldSubjectRef(ref: SubjectRef): ref is HeldSubjectRef {
  return (HELD_SUBJECT_KINDS as ReadonlyArray<SubjectKind>).includes(ref.kind)
}

export async function fetchOverlays(args: {
  userId: string
  subjectRefs: ReadonlyArray<HeldSubjectRef>
  endpoint?: string
  fetchImpl?: FetchImpl
  signal?: AbortSignal
}): Promise<SubjectOverlay[]> {
  const fetchImpl = args.fetchImpl ?? fetch
  const url = args.endpoint ?? `${PORTFOLIO_API_BASE}/overlays`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [USER_ID_HEADER]: args.userId,
    },
    body: JSON.stringify({ subject_refs: args.subjectRefs }),
    signal: args.signal,
  })
  if (!response.ok) {
    let detail: string | null = null
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === 'string') detail = body.error
    } catch {
      // tolerate non-JSON error bodies; fall through to the generic message
    }
    throw new PortfolioFetchError(
      response.status,
      detail ?? `portfolio overlays failed with HTTP ${response.status}`,
    )
  }
  const body = (await response.json()) as { overlays: SubjectOverlay[] }
  return body.overlays
}

// True when the user holds an open position in this subject_ref. Closed
// positions are reported by the service but don't surface as a "Held"
// badge — the bead's distinction is "currently held vs. watchlisted",
// not historical exposure.
export function hasOpenPosition(overlay: SubjectOverlay | undefined): boolean {
  if (!overlay) return false
  return overlay.contributions.some((c) => c.held_state === 'open')
}
