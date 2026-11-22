// Client for an issuer's guidance against its reported results (#733), read from
// the public evidence route `/v1/evidence/guidance-record` (no session required).

import { defineResource } from '../fetch/resource.ts'

export type GuidanceBasis = 'gaap' | 'non_gaap'
export type GuidanceOutcome = 'beat' | 'in_line' | 'miss' | 'not_comparable' | 'not_yet_reported'
export type GuidanceSource = { document_id: string; claim_id: string | null; filed_on: string; form?: string | null; url: string | null; quote: string }

export type GuidanceComparison = {
  quarter_end: string | null
  metric: string
  basis: GuidanceBasis
  unit: 'usd' | 'usd_per_share' | 'percent'
  guided: { low: number; high: number; source: GuidanceSource }
  actual: { value: number; source: GuidanceSource } | null
  outcome: GuidanceOutcome
  reason?: 'no_same_basis_actual' | 'conflicting_guidance' | 'conflicting_actuals' | 'split_between_releases' | 'split_history_missing'
}

export type GuidanceHitRate = { metric: string; basis: GuidanceBasis; hits: number; compared: number }

export type GuidanceRecordEnvelope = {
  issuer_id: string
  quarters: number
  record: { rows: ReadonlyArray<GuidanceComparison>; hit_rates: ReadonlyArray<GuidanceHitRate> }
}

export async function fetchGuidanceRecord(
  issuerId: string,
  init: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<GuidanceRecordEnvelope> {
  const fetchFn = init.fetchImpl ?? fetch
  const res = await fetchFn(`/v1/evidence/guidance-record?issuer_id=${encodeURIComponent(issuerId)}`, { signal: init.signal })
  if (!res.ok) throw new Error(`guidance record fetch failed: HTTP ${res.status}`)
  return (await res.json()) as GuidanceRecordEnvelope
}

export const guidanceRecord = defineResource({
  freshness: 'filed',
  load: async (issuerId: string, signal) => {
    const data = await fetchGuidanceRecord(issuerId, { signal })
    return data.issuer_id === issuerId
      ? { kind: 'ready', data }
      : { kind: 'unavailable', reason: 'guidance record response did not match requested issuer' }
  },
})
