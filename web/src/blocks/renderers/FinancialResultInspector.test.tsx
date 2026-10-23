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
        derivation: null,
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

test('a bound share price shows the observation it came from and the split restating it', () => {
  const price = inspection({
    payload: { kind: 'value', value: '120', unit: { kind: 'currency_per_share', currency: 'USD' }, exact: true, rounding: null },
    definitions: [{ metric_key: 'share_price', definition_version: 'share_price.v1' }],
    inputs: [{
      input_slot: 'px', status: 'bound', observation_id: 'o0000000-0000-4000-8000-000000000001', listing_id: 'l0000000-0000-4000-8000-000000000001',
      source: { source_id: 'src-polygon', body_sha256: 'd'.repeat(64) }, metric: { metric_key: 'share_price', definition_version: 'share_price.v1' },
      value: '1200', split_adjustment: { reference_date: '2024-06-10', factor: { numerator: '10', denominator: '1' } }, unit: { kind: 'currency_per_share', currency: 'USD' },
      observation: { kind: 'session_close', observed_at: '2024-06-07T20:00:00.000Z', known_at: '2024-06-07T20:15:00.000Z' },
    }],
  })
  const html = renderToStaticMarkup(<FinancialResultInspector load={{ kind: 'ready', inspection: price }} />)
  for (const expected of [
    '>1200<', 'currency per share (USD)', 'share_price share_price.v1', 'session close at 2024-06-07T20:00:00.000Z', '2024-06-07T20:15:00.000Z',
    '÷ 10/1 to 2024-06-10', `src-polygon · body ${'d'.repeat(64)} · listing l0000000-0000-4000-8000-000000000001 · observation o0000000-0000-4000-8000-000000000001`,
  ]) {
    assert.ok(html.includes(expected), `missing ${expected}`)
  }
})

test('a derived quarter shows its derivation, then each term with its value, dates, and filing', () => {
  const term = (sign: '+' | '-', span: 'fiscal_year' | 'quarter' | 'year_to_date', fiscal_period: string, start: string, end: string, raw_token: string, form: string, accession: string, filed: string) => ({
    sign, span, fiscal_year: 2024, fiscal_period, start, end, raw_token, token_proof_hash: 'e'.repeat(64),
    source: { source_id: `src-${fiscal_period}`, accession, form, filed, locator: `loc-${fiscal_period}` },
  })
  const derived = (fiscal_period: string, start: string, terms: ReturnType<typeof term>[]) => inspection({
    payload: { kind: 'value', value: '170.5', unit: { kind: 'currency', currency: 'USD' }, exact: true, rounding: null },
    inputs: [{
      input_slot: 'a_rev', status: 'bound', fact_id: 'f0000000-0000-4000-8000-000000000002',
      source: { source_id: terms[0]!.source.source_id, document_id: null, source_version_hash: 'v'.repeat(64), locator: 'loc-derived' },
      metric: { metric_key: 'revenue', definition_version: 'revenue.v1' }, value: '170.5', unit: { kind: 'currency', currency: 'USD' },
      period: { kind: 'duration', start, end: terms[0]!.end, fiscal_year: 2024, fiscal_period },
      precision_status: 'derived_from_source_tokens',
      derivation: { version: 'period_difference.v1', concept: 'Revenues', unit: 'USD', terms },
      publication: { attestation_id: 'att-2', available_no_later_than: '2025-02-15T23:59:59.999-05:00', precision: 'date' },
    }],
  })
  const render = (load: FinancialResultInspection) => renderToStaticMarkup(<FinancialResultInspector load={{ kind: 'ready', inspection: load }} />)

  const fourth = render(derived('Q4', '2024-10-01', [
    term('+', 'fiscal_year', 'FY', '2024-01-01', '2024-12-31', '620.5', '10-K', '0001234567-25-000004', '2025-02-15'),
    term('-', 'quarter', 'Q1', '2024-01-01', '2024-03-31', '140', '10-Q', '0001234567-24-000001', '2024-05-01'),
    term('-', 'quarter', 'Q2', '2024-04-01', '2024-06-30', '150', '10-Q', '0001234567-24-000002', '2024-08-01'),
    term('-', 'quarter', 'Q3', '2024-07-01', '2024-09-30', '160.000', '10-Q', '0001234567-24-000003', '2024-11-01'),
  ]))
  for (const expected of [
    'derived from source tokens',
    '>Derived<', '<span class="break-normal">Q4 2024 = FY 2024 − Q1 2024 − Q2 2024 − Q3 2024</span>',
    '>FY 2024<', '620.5 · 2024-01-01 to 2024-12-31 · 10-K 0001234567-25-000004 filed 2025-02-15 · src-FY · loc-FY',
    '>− Q1 2024<', '140 · 2024-01-01 to 2024-03-31 · 10-Q 0001234567-24-000001 filed 2024-05-01 · src-Q1 · loc-Q1',
    '>− Q3 2024<', '160.000 · 2024-07-01 to 2024-09-30 · 10-Q 0001234567-24-000003 filed 2024-11-01 · src-Q3 · loc-Q3',
  ]) {
    assert.ok(fourth.includes(expected), `missing ${expected}`)
  }

  const cashFlow = render(derived('Q3', '2024-07-01', [
    term('+', 'year_to_date', 'Q3', '2024-01-01', '2024-09-30', '135', '10-Q', '0001234567-24-000003', '2024-11-01'),
    term('-', 'year_to_date', 'Q2', '2024-01-01', '2024-06-30', '85', '10-Q', '0001234567-24-000002', '2024-08-01'),
  ]))
  for (const expected of ['>Q3 2024 = Q3 2024 year to date − Q2 2024 year to date<', '>Q3 2024 year to date<', '>− Q2 2024 year to date<']) {
    assert.ok(cashFlow.includes(expected), `missing ${expected}`)
  }
  assert.ok(!render(inspection()).includes('>Derived<'), 'a value a filing states shows no derivation')
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
  assert.equal(payloadSummary({ kind: 'ranking', complete: false }, 'peer_compare'), 'Partial ranking: not every requested company has a value')
  assert.equal(payloadSummary({ kind: 'ranking', complete: false }, 'period_rank'), 'Partial ranking: not every period has a value')
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
