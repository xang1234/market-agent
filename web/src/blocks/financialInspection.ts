// The authorized inspection of one committed financial result
// (GET /v1/financial/results/:id, services/financial-engine/src/inspection.ts).
// Values stay the canonical decimal strings the server sent: nothing here
// parses, rounds, or reformats them, so what is copied is exactly what was
// certified. The inspector prints a value as the answer did (readable.ts)
// with this exact text beside it.

import { authenticatedJson, type FetchImpl } from '../http/authFetch.ts'
import { humanize } from '../evidence/readable.ts'

export const SUPPORTED_INSPECTION_SCHEMA_VERSION = 'financial_result_inspection.v1'
/** v1 plus the P/E assumptions a scenario result reads (#201). */
export const INSPECTION_V2_SCHEMA_VERSION = 'financial_result_inspection.v2'

/** A P/E the user supplied: plan configuration, never reported data. */
export type FinancialInspectedAssumption = {
  assumption_id: string
  scenario: 'bear' | 'base' | 'bull'
  value: string
  attribution: { kind: 'user_request'; ref: string; captured_at: string }
  assumption_hash: string
}

export type FinancialDerivation = {
  version: string
  concept: string
  unit: string
  terms: ReadonlyArray<{
    sign: '+' | '-'
    span: 'fiscal_year' | 'quarter' | 'year_to_date'
    fiscal_year: number
    fiscal_period: string
    start: string
    end: string
    raw_token: string
    token_proof_hash: string
    source: { source_id: string; accession: string; form: string; filed: string; locator: string }
  }>
}

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
      derivation: FinancialDerivation | null
      /** Present for a value that stands for a metric its concept does not name. */
      inference?: { kind: 'no_noncontrolling_interest'; concept: string; checked: ReadonlyArray<string> }
      publication: { attestation_id: string; available_no_later_than: string; precision: string }
    }
  | {
      input_slot: string
      status: 'bound'
      observation_id: string
      listing_id: string
      source: { source_id: string; body_sha256: string }
      metric: { metric_key: string; definition_version: string }
      value: string
      split_adjustment: { reference_date: string; factor: { numerator: string; denominator: string } }
      unit: unknown
      observation: { kind: 'last_trade' | 'session_close'; observed_at: string; known_at: string }
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
      /** v2 only. */
      assumptions?: ReadonlyArray<FinancialInspectedAssumption>
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
  return inspection.availability === 'available' &&
    (inspection.schema_version === SUPPORTED_INSPECTION_SCHEMA_VERSION || inspection.schema_version === INSPECTION_V2_SCHEMA_VERSION)
    ? inspection
    : null
}

/** The certified canonical value, exactly as stored, for display and copying; null for gaps, predicates, and rankings. */
export function canonicalValue(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null
  const record = payload as { kind?: unknown; value?: unknown }
  return record.kind === 'value' && typeof record.value === 'string' ? record.value : null
}

/** What a clicked value printed, so the inspector heads with the cell the reader chose. */
export type FinancialResultShown = { subject: string | null; measure: string; period: string | null; value: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A fiscal period as the answer table writes it: "Q4 FY2026 · ended Sep 2026", "FY2026". */
export function fiscalPeriodText(period: { fiscal_year: number; fiscal_period: string; end?: string | null }): string {
  const name = period.fiscal_period === 'FY' ? `FY${period.fiscal_year}` : `${period.fiscal_period} FY${period.fiscal_year}`
  const end = period.end ? /^(\d{4})-(\d{2})/u.exec(period.end) : null
  return end ? `${name} · ended ${MONTHS[Number(end[2]) - 1]} ${end[1]}` : name
}

/** A term as its derivation writes it: signed, except a leading added term. */
export function derivationTermLabel(term: FinancialDerivation['terms'][number], index: number): string {
  const name = term.span === 'fiscal_year'
    ? `FY${term.fiscal_year}`
    : `${term.fiscal_period} FY${term.fiscal_year}${term.span === 'year_to_date' ? ' year to date' : ''}`
  return index === 0 && term.sign === '+' ? name : `${term.sign === '-' ? '−' : '+'} ${name}`
}

export function derivationFormula(period: { fiscal_year: number; fiscal_period: string }, derivation: FinancialDerivation): string {
  return `${fiscalPeriodText({ ...period, end: null })} = ${derivation.terms.map(derivationTermLabel).join(' ')}`
}

/** A unit as plain words, without converting any value. */
export function unitText(unit: unknown): string {
  if (unit === null || typeof unit !== 'object') return 'Unknown unit'
  const record = unit as { kind?: unknown; currency?: unknown }
  const kind = typeof record.kind === 'string' ? record.kind.replaceAll('_', ' ') : 'unknown unit'
  return typeof record.currency === 'string' ? `${kind} (${record.currency})` : kind
}

/** The payload's outcome in words for predicates, rankings, and gaps. */
export function payloadSummary(payload: unknown, operation?: string): string {
  if (payload === null || typeof payload !== 'object') return 'No result'
  const record = payload as { kind?: unknown; outcome?: unknown; comparison?: unknown; reason_code?: unknown; complete?: unknown }
  switch (record.kind) {
    case 'value':
      return String((payload as { value: unknown }).value)
    case 'predicate':
      return `${record.outcome === true ? 'Met' : 'Not met'} (${String(record.comparison)})`
    case 'ranking':
      if (record.complete === true) return 'Complete ranking'
      return `Partial ranking: not every ${operation === 'period_rank' ? 'period' : 'requested company'} has a value`
    case 'gap':
      return `Not available (${String(record.reason_code ?? 'unknown')})`
    default:
      return 'Unrecognized result'
  }
}

// Each operation's name and its formula in words. An operation missing here reads as its key in words.
export const OPERATIONS: Readonly<Record<string, { name: string; formula: string }>> = {
  absolute_change: { name: 'Change', formula: 'Current − prior' },
  percent_change_positive_base: { name: 'Percent change', formula: '(Current − prior) ÷ prior' },
  gross_margin: { name: 'Gross margin', formula: 'Gross profit ÷ revenue' },
  operating_margin: { name: 'Operating margin', formula: 'Operating income ÷ revenue' },
  net_margin: { name: 'Net margin', formula: 'Net income ÷ revenue' },
  free_cash_flow: { name: 'Free cash flow', formula: 'Operating cash flow − capital expenditure' },
  net_cash: { name: 'Net cash', formula: 'Cash and investments − debt, from one 10-K' },
  total_debt: { name: 'Total debt', formula: 'Long-term debt + commercial paper + short-term borrowings, from one 10-K' },
  ratio: { name: 'Ratio', formula: 'Numerator ÷ denominator' },
  trailing_sum: { name: 'Trailing four quarters', formula: 'Sum of four consecutive quarters' },
  threshold: { name: 'Threshold check', formula: 'Value compared with the stated threshold' },
  peer_compare: { name: 'Ranking', formula: 'Companies ranked on one measure' },
  period_rank: { name: 'Ranking', formula: 'Periods ranked on one measure' },
  market_cap: { name: 'Market cap', formula: 'Share price × shares outstanding' },
  pe_ratio: { name: 'P/E', formula: 'Share price ÷ diluted EPS' },
  spread: { name: 'Difference', formula: 'First company − second company, each in its own period' },
  scenario_eps_multiple: { name: 'Scenario value', formula: 'Diluted EPS × your P/E' },
}

/** What the inspector heads with when the click did not say: the operation's name or the metric's, and the input's period. */
export function inspectionHeading(inspection: FinancialResultInspection): { title: string; subtitle: string | null } | null {
  const details = inspectableDetails(inspection)
  if (details === null) return null
  const operation = details.formula?.operation
  const metric = details.definitions[0]?.metric_key
  const title = operation ? OPERATIONS[operation]?.name ?? humanize(operation) : metric ? humanize(metric) : null
  const fact = details.inputs.find((input): input is Extract<FinancialInspectedInput, { fact_id: string }> => 'fact_id' in input)
  return title === null ? null : { title, subtitle: fact ? fiscalPeriodText(fact.period) : null }
}
