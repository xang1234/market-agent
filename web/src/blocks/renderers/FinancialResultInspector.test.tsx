import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import type { FinancialResultInspection } from '../financialInspection.ts'
import { canonicalValue, payloadSummary, SUPPORTED_INSPECTION_SCHEMA_VERSION } from '../financialInspection.ts'
import { FinancialResultInspector } from './FinancialResultInspector.tsx'

const LARGE = '383285000000.123456789012345678'
const SMALL = '0.000000000000000001'

function inspection(overrides: Partial<Extract<FinancialResultInspection, { availability: 'available' }>> = {}): FinancialResultInspection {
  return {
    schema_version: SUPPORTED_INSPECTION_SCHEMA_VERSION,
    availability: 'available',
    result_id: 'r0000000-0000-4000-8000-000000000001',
    run_id: 'u0000000-0000-4000-8000-000000000001',
    unit_id: 'answer',
    output_id: 'a_rev',
    disposition: 'verified',
    payload: { kind: 'value', value: LARGE, unit: { kind: 'currency', currency: 'USD' }, exact: true, rounding: null },
    result_hash: 'a'.repeat(64),
    interpretation: 'Revenue for Alpha Industries Inc., FY 2023, as originally reported.',
    coverage_state: 'complete',
    time: { knowledge_cutoff: '2024-03-01T00:00:00.000Z', time_mode: 'public_information', finalized_at: '2024-03-01T00:00:01.000Z' },
    publication: { snapshot_id: 's0000000-0000-4000-8000-000000000001', certificate_digest: 'c'.repeat(64) },
    formula: null,
    definitions: [{ metric_key: 'revenue', definition_version: 'revenue.v1' }],
    inputs: [
      {
        input_slot: 'a_rev', status: 'bound', fact_id: 'f0000000-0000-4000-8000-000000000001',
        source: { source_id: 'src-1', document_id: null, source_version_hash: 'v'.repeat(64), locator: 'javascript:alert(1)' },
        metric: { metric_key: 'revenue', definition_version: 'revenue.v1' }, value: LARGE, unit: { kind: 'currency', currency: 'USD' },
        period: { kind: 'fiscal_period', start: '2023-01-01', end: '2023-12-31', fiscal_year: 2023, fiscal_period: 'FY' },
        precision_status: 'source_token_preserved',
        publication: { attestation_id: 'att-1', available_no_later_than: '2024-01-10T23:59:59.999-05:00', precision: 'date' },
      },
      { input_slot: 'b_rev', status: 'gap', reason_code: 'not_public_at_cutoff' },
    ],
    ...overrides,
  }
}

test('the inspector shows what the certificate covers, with every number exactly as certified', () => {
  const html = renderToStaticMarkup(<FinancialResultInspector load={{ kind: 'ready', inspection: inspection() }} onCopy={() => {}} />)
  for (const expected of [
    LARGE, 'revenue revenue.v1', '2024-03-01T00:00:00.000Z', 'public information', 'complete', 'currency (USD)',
    'FY 2023 (2023-01-01 to 2023-12-31)', 'source token preserved', '2024-01-10T23:59:59.999-05:00 (date)',
    'src-1 · version', 'c'.repeat(64), 'a'.repeat(64), 'Eligible', 'No eligible input (not_public_at_cutoff)', 'Verified calculation', 'Copy value',
  ]) {
    assert.ok(html.includes(expected), `missing ${expected}`)
  }
  assert.ok(!html.includes('383,285') && !html.includes('383.29'), 'values are never reformatted or rounded')
  assert.ok(!/<a\b/u.test(html), 'no link is built from a source locator or id')
})

test('tiny decimals and derived results keep their canonical text', () => {
  const small = inspection({ payload: { kind: 'value', value: SMALL, unit: { kind: 'ratio' }, exact: true, rounding: null }, formula: { operation: 'gross_margin', operation_version: 'gross_margin.v1', numeric_policy_version: 'numeric.v1' } })
  const html = renderToStaticMarkup(<FinancialResultInspector load={{ kind: 'ready', inspection: small }} />)
  assert.ok(html.includes(SMALL) && !html.includes('1e-18'))
  assert.ok(html.includes('gross_margin (gross_margin.v1)') && html.includes('numeric.v1'))
  assert.ok(!html.includes('Copy value'), 'copying is offered only where the host provides it')
  assert.equal(canonicalValue(small.availability === 'available' ? small.payload : null), SMALL)
})

test('predicates, partial rankings, and gaps say what they are', () => {
  assert.equal(payloadSummary({ kind: 'predicate', predicate: 'threshold', comparison: 'gt', outcome: true }), 'Met (gt)')
  assert.match(payloadSummary({ kind: 'ranking', complete: false }), /Partial ranking/u)
  assert.equal(payloadSummary({ kind: 'gap', reason_code: 'stale_input' }), 'Not available (stale_input)')
  const partial = renderToStaticMarkup(<FinancialResultInspector load={{ kind: 'ready', inspection: inspection({ coverage_state: 'partial' }) }} />)
  assert.ok(partial.includes('Partial coverage'))
})

test('an unknown or legacy version is legacy output, never verified values', () => {
  for (const legacy of [
    { schema_version: SUPPORTED_INSPECTION_SCHEMA_VERSION, availability: 'unsupported_version', result_id: 'r', run_id: 'u', reason_code: 'unsupported_version' } as const,
    inspection({ schema_version: 'financial_result_inspection.v9' }),
  ]) {
    const html = renderToStaticMarkup(<FinancialResultInspector load={{ kind: 'ready', inspection: legacy }} />)
    assert.ok(html.includes('Legacy output'))
    assert.ok(!html.includes('Verified calculation') && !html.includes(LARGE))
    assert.ok(!html.includes('Pinned replay'), 'pinned replay is offered only for a result this client fully understands')
  }
})

test('loading and error states are announced', () => {
  assert.match(renderToStaticMarkup(<FinancialResultInspector load={{ kind: 'loading', resultId: 'r' }} />), /role="status"/u)
  const error = renderToStaticMarkup(<FinancialResultInspector load={{ kind: 'error', resultId: 'r', message: 'This calculation is not available to inspect.' }} />)
  assert.match(error, /role="alert"[^>]*>This calculation is not available to inspect\./u)
})
