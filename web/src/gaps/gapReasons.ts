import type { KeyStatWarningCode } from '../symbol/stats.ts'

// Codes a blank key stat or grid cell can carry, in words a reader can act on.
// Grid codes come from services/analyst-grids (financial-column.ts, reader-question-column.ts)
// and the erasure trigger in db/migrations/0051.
const GAP_REASONS: Readonly<Record<KeyStatWarningCode, string> & Record<string, string>> = {
  missing_statement_line: 'The filing does not report a needed line.',
  missing_market_price: 'No market price yet.',
  null_statement_value: 'A needed figure is blank in the filing.',
  zero_denominator: 'The base figure is zero.',
  currency_mismatch: 'The inputs are in different currencies.',
  coverage_incomplete: 'The filing data is incomplete.',
  input_mismatch: 'The inputs do not belong together.',
  stale_input: 'An input is too old to use.',
  subject_not_an_issuer: 'Only available for companies.',
  issuer_only: 'Only available for companies.',
  verification_failed: 'The figure could not be verified.',
  planning_unavailable: 'The calculation could not be planned.',
  unsupported: 'This column does not cover this company.',
  configuration_needed: 'This column needs more setup.',
  request_conflict: 'Another request for this grid conflicted. Rerun it.',
  run_cancelled: 'The calculation was cancelled.',
  run_failed: 'The calculation failed.',
  no_result: 'No verified result.',
  no_documents: 'No filings or documents for this company yet.',
  no_document_text: 'The documents have no readable text.',
  no_relevant_claims: 'The documents do not discuss this.',
  financial_result_erased: 'The verified result was deleted.',
}

export function gapReason(code: string | null | undefined): string | null {
  return (code && Object.hasOwn(GAP_REASONS, code) && GAP_REASONS[code]) || null
}
