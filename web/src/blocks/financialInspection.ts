// The authorized inspection of one committed financial result
// (GET /v1/financial/results/:id, services/financial-engine/src/inspection.ts).
// Values stay the canonical decimal strings the server sent: nothing here
// parses, rounds, or reformats them, so what is shown and copied is exactly
// what was certified.

import { authenticatedJson, type FetchImpl } from '../http/authFetch.ts'

export const SUPPORTED_INSPECTION_SCHEMA_VERSION = 'financial_result_inspection.v1'

export type FinancialInspectedInput =
  | {
      input_slot: string
      status: 'bound'
      fact_id: string
      source: { source_id: string; document_id: string | null; source_version_hash: string; locator: string | null }
      metric: { metric_key: string; definition_version: string }
      value: string
      unit: unknown
      period: { kind: string; start: string | null; end: string; fiscal_year: number; fiscal_period: string }
      precision_status: string
      publication: { attestation_id: string; available_no_later_than: string; precision: string }
    }
  | { input_slot: string; status: 'gap'; reason_code: string | null }

export type FinancialResultInspection =
  | {
      schema_version: string
      availability: 'available'
      result_id: string
      run_id: string
      unit_id: string
      output_id: string
      disposition: string
      payload: unknown
      result_hash: string
      interpretation: string | null
      coverage_state: 'complete' | 'partial' | 'none' | null
      time: { knowledge_cutoff: string; time_mode: string; finalized_at: string }
      publication: { snapshot_id: string; certificate_digest: string }
      formula: { operation: string; operation_version: string; numeric_policy_version: string } | null
      definitions: ReadonlyArray<{ metric_key: string; definition_version: string }>
      inputs: ReadonlyArray<FinancialInspectedInput>
    }
  | { schema_version: string; availability: 'unsupported_version'; result_id: string; run_id: string; reason_code: string }

export async function fetchFinancialResultInspection(input: { userId: string; resultId: string; fetchImpl?: FetchImpl }): Promise<FinancialResultInspection> {
  return authenticatedJson<FinancialResultInspection>(`/v1/financial/results/${encodeURIComponent(input.resultId)}`, {
    method: 'GET',
    userId: input.userId,
    fetchImpl: input.fetchImpl,
  })
}

/**
 * Whether this client can show the inspection's details, and so offer pinned
 * replay; anything else is shown as legacy output, never as verified.
 */
export function inspectableDetails(inspection: FinancialResultInspection): Extract<FinancialResultInspection, { availability: 'available' }> | null {
  return inspection.availability === 'available' && inspection.schema_version === SUPPORTED_INSPECTION_SCHEMA_VERSION ? inspection : null
}

/** The certified canonical value, exactly as stored, for display and copying; null for gaps, predicates, and rankings. */
export function canonicalValue(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null
  const record = payload as { kind?: unknown; value?: unknown }
  return record.kind === 'value' && typeof record.value === 'string' ? record.value : null
}

/** A unit as plain words, without converting any value. */
export function unitText(unit: unknown): string {
  if (unit === null || typeof unit !== 'object') return 'Unknown unit'
  const record = unit as { kind?: unknown; currency?: unknown }
  const kind = typeof record.kind === 'string' ? record.kind.replaceAll('_', ' ') : 'unknown unit'
  return typeof record.currency === 'string' ? `${kind} (${record.currency})` : kind
}

/** The payload's outcome in words for predicates, rankings, and gaps. */
export function payloadSummary(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return 'No result'
  const record = payload as { kind?: unknown; outcome?: unknown; comparison?: unknown; reason_code?: unknown; complete?: unknown }
  switch (record.kind) {
    case 'value':
      return String((payload as { value: unknown }).value)
    case 'predicate':
      return `${record.outcome === true ? 'Met' : 'Not met'} (${String(record.comparison)})`
    case 'ranking':
      return record.complete === true ? 'Complete ranking' : 'Partial ranking: not every requested company has a value'
    case 'gap':
      return `Not available (${String(record.reason_code ?? 'unknown')})`
    default:
      return 'Unrecognized result'
  }
}
