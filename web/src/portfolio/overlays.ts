// Client for the portfolio overlays endpoint (services/portfolio §3.16,
// route POST /v1/portfolios/overlays). Returns one entry per requested
// subject_ref with the contributing portfolios; an empty contributions
// list means the user holds no position in that subject.

import type { SubjectRef } from '../symbol/search.ts'

export const PORTFOLIO_API_BASE = '/v1/portfolios'

const USER_ID_HEADER = 'x-user-id'

export type HeldSubjectKind = 'instrument' | 'listing'

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
  subject_ref: { kind: HeldSubjectKind; id: string }
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

export function isHeldSubjectRef(
  ref: SubjectRef,
): ref is { kind: HeldSubjectKind; id: string } {
  return ref.kind === 'instrument' || ref.kind === 'listing'
}

export async function fetchOverlays(args: {
  userId: string
  subjectRefs: ReadonlyArray<{ kind: HeldSubjectKind; id: string }>
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
