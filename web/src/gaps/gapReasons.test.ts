import assert from 'node:assert/strict'
import test from 'node:test'

import { gapReason } from './gapReasons.ts'

// Every code a blank grid cell can carry: the flags written in
// services/analyst-grids/src (financial-column.ts, reader-question-column.ts,
// cell-runner.ts) and the erasure trigger in db/migrations/0051. run_in_progress
// and publication_failed leave the cell pending; parent_authority_required is
// discovery-only. A code added there belongs here too.
const GRID_GAP_CODES = [
  'subject_not_an_issuer', 'issuer_only', 'verification_failed', 'planning_unavailable', 'unsupported',
  'configuration_needed', 'request_conflict', 'run_cancelled', 'run_failed', 'no_result', 'no_documents',
  'no_document_text', 'no_relevant_claims', 'financial_result_erased',
]

test('every grid coverage code that reaches a blank cell has a reason in words', () => {
  assert.deepEqual(GRID_GAP_CODES.filter((code) => gapReason(code) === null), [])
})

test('an unknown or inherited name is not a reason', () => {
  for (const code of ['totally_unknown', '__proto__', 'constructor', 'toString', 'MISSING_MARKET_PRICE', '', null, undefined]) {
    assert.equal(gapReason(code), null, String(code))
  }
})
