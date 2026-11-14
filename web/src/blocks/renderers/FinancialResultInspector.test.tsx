import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import type { FinancialDerivation, FinancialInspectedInput, FinancialResultInspection, FinancialResultShown } from '../financialInspection.ts'
import { financialHeading, INSPECTION_V2_SCHEMA_VERSION, payloadSummary, SUPPORTED_INSPECTION_SCHEMA_VERSION } from '../financialInspection.ts'
import { installDomGlobals } from '../../analyst-grids/testDom.ts'
import { FinancialResultInspector } from './FinancialResultInspector.tsx'

process.env.TZ = 'UTC'

type Inspected = Extract<FinancialResultInspection, { availability: 'available' }>
type FactInput = Extract<FinancialInspectedInput, { fact_id: string }>
type Term = FinancialDerivation['terms'][number]

const USD = { kind: 'currency', currency: 'USD' } as const

function term(sign: '+' | '-', span: Term['span'], fiscal_period: string, start: string, end: string, raw_token: string, form: string, filed: string): Term {
  return {
    sign, span, fiscal_year: 2026, fiscal_period, start, end, raw_token, token_proof_hash: 'e'.repeat(64),
    source: { source_id: `src-${fiscal_period}-${span}`, accession: `0000723125-26-0000${fiscal_period.slice(-1)}`, form, filed, locator: `sec_edgar:companyfacts:CIK0000723125#Revenues|USD|${fiscal_period}|${start}..${end}` },
  }
}

const Q4_TERMS = [
  term('+', 'fiscal_year', 'FY', '2025-08-29', '2026-09-03', '133188000000', '10-K', '2026-10-09'),
  term('-', 'quarter', 'Q1', '2025-08-29', '2025-11-27', '13643000000', '10-Q', '2025-12-18'),
  term('-', 'quarter', 'Q2', '2025-11-28', '2026-02-26', '23860000000', '10-Q', '2026-03-19'),
  term('-', 'quarter', 'Q3', '2026-02-27', '2026-05-28', '41456000000', '10-Q', '2026-06-25'),
]

function fact(metric_key: string, value: string, terms: Term[] | null, overrides: Partial<FactInput> = {}): FactInput {
  return {
    input_slot: `a_${metric_key}`, status: 'bound', fact_id: '62ce4cc0-70b2-4124-b57d-92b1179ecc6d', company: 'Micron Technology Inc',
    source: { source_id: terms?.[0]?.source.source_id ?? 'src-direct', document_id: null, source_version_hash: 'v'.repeat(64), locator: 'sec_edgar:derivation:CIK0000723125#Revenues|USD|0000723125-26-000023|2026-05-29..2026-09-03', filed: null },
    metric: { metric_key, definition_version: `${metric_key}.v1` }, value, unit: USD,
    period: { kind: 'duration', start: '2026-05-29', end: '2026-09-03', fiscal_year: 2026, fiscal_period: 'Q4' },
    precision_status: terms ? 'derived_from_source_tokens' : 'source_token_preserved',
    derivation: terms ? { version: 'period_difference.v1', concept: 'Revenues', unit: 'USD', terms } : null,
    publication: { attestation_id: 'b90a68a4-6e56-4184-8c99-876b9a485fcb', available_no_later_than: '2026-11-12T23:46:37.775Z', precision: 'instant', source_timezone: 'America/New_York' },
    ...overrides,
  }
}

function inspection(overrides: Partial<Inspected> = {}): Inspected {
  return {
    schema_version: SUPPORTED_INSPECTION_SCHEMA_VERSION,
    availability: 'available',
    result_id: '98363897-79f9-46d9-831d-ff85eb508f7f',
    run_id: '73971de0-a74e-4b32-8870-bf62d2e18f19',
    unit_id: 'answer',
    output_id: 'out_a_revenue_fy2026_q4',
    disposition: 'verified',
    payload: { kind: 'value', value: '54229000000', unit: USD, exact: true, rounding: null },
    result_hash: 'a'.repeat(64),
    interpretation: 'Subjects: MU · XNAS — Micron Technology Inc (issuer:b6f1d101-ad99-4fce-96d7-ab694e32a0fb). Information public by 2026-11-14T01:50:04.131Z (UTC).',
    coverage_state: 'complete',
    time: { knowledge_cutoff: '2026-11-14T01:50:04.131Z', time_mode: 'public_information', finalized_at: '2026-11-14T01:50:04.275Z' },
    publication: { snapshot_id: '51bb2a4d-1660-4185-aadc-632015c5ed19', certificate_digest: 'c'.repeat(64) },
    formula: null,
    measure: 'Revenue',
    definitions: [{ metric_key: 'revenue', definition_version: 'revenue.v1' }],
    inputs: [fact('revenue', '54229000000', Q4_TERMS)],
    ...overrides,
  }
}

const MARGIN = inspection({
  payload: { kind: 'value', value: '0.86756163676261778753065702852717180844197753969278', unit: { kind: 'ratio' }, exact: false, rounding: null },
  formula: { operation: 'gross_margin', operation_version: 'gross_margin.v1', numeric_policy_version: 'numeric-policy.v1', reads_as_multiple: false },
  measure: 'Gross margin (gross profit / revenue)',
  definitions: [{ metric_key: 'revenue', definition_version: 'revenue.v1' }, { metric_key: 'gross_profit', definition_version: 'gross_profit.v1' }],
  inputs: [fact('gross_profit', '47047000000', Q4_TERMS.map((entry) => ({ ...entry, raw_token: '1000000000' }))), fact('revenue', '54229000000', Q4_TERMS)],
})

function render(load: FinancialResultInspection, shown?: FinancialResultShown): Document {
  return new JSDOM(renderToStaticMarkup(<FinancialResultInspector load={{ kind: 'ready', inspection: load }} shown={shown} />)).window.document
}

const text = (element: Element | null | undefined) => element?.textContent ?? null
const rows = (document: Document) => [...document.querySelectorAll('tbody tr')].map((row) => [...row.children].map((cell) => cell.textContent))
const sources = (document: Document) => [...document.querySelectorAll('[aria-labelledby="inspector-sources"] li')].map((item) => [...item.querySelectorAll('p')].map((line) => line.textContent).join(' | '))
const detail = (document: Document, label: string) => [...document.querySelectorAll('[data-testid="inspector-details"] dt')].find((term) => term.textContent === label)?.nextElementSibling

test('the value leads as the answer prints it, with the exact certified value beside it to copy', () => {
  const document = render(inspection({ payload: { kind: 'value', value: '383285000000.123456789012345678', unit: USD, exact: true, rounding: null } }))
  assert.equal(text(document.querySelector('[data-testid="financial-inspector-value"]')), '$383.3B')
  const exact = document.querySelector('[data-testid="financial-inspector-exact"]')
  assert.equal(text(exact), '383285000000.123456789012345678', 'the certified decimal, in full on the page')
  assert.equal(exact?.classList.contains('truncate'), false, 'never cut to a hover-only title')
  assert.ok(document.querySelector('button[aria-label="Copy the exact value to the clipboard"]'), 'the exact value is one click from the clipboard')
  const shown = render(inspection(), { subject: 'Micron Technology Inc', measure: 'Revenue', period: 'Q4 FY2026 · ended Sep 2026', value: '$54.2B' })
  assert.equal(text(shown.querySelector('[data-testid="financial-inspector-value"]')), '$54.2B', 'a clicked value heads with the text it showed')
})

test('a derived quarter shows its derivation term by term and lists each filing it came from', () => {
  const document = render(inspection())
  assert.equal(text(document.querySelector('[data-testid="financial-inspector-formula"]')), 'Derived from filings: Q4 FY2026 = FY2026 − Q1 FY2026 − Q2 FY2026 − Q3 FY2026')
  assert.deepEqual(rows(document), [
    ['Revenue', 'Q4 FY2026 · ended Sep 2026', '$54.2B'],
    ['FY2026', '10-K filed Oct 9, 2026', '$133.2B'],
    ['− Q1 FY2026', '10-Q filed Dec 18, 2025', '$13.6B'],
    ['− Q2 FY2026', '10-Q filed Mar 19, 2026', '$23.9B'],
    ['− Q3 FY2026', '10-Q filed Jun 25, 2026', '$41.5B'],
  ])
  assert.deepEqual(sources(document), [
    '10-K filed Oct 9, 2026 | Revenue FY2026',
    '10-Q filed Dec 18, 2025 | Revenue Q1 FY2026',
    '10-Q filed Mar 19, 2026 | Revenue Q2 FY2026',
    '10-Q filed Jun 25, 2026 | Revenue Q3 FY2026',
  ])
  const source = document.querySelector('[aria-labelledby="inspector-sources"] [data-inspection-kind="source"]')
  assert.equal(source?.getAttribute('data-inspection-id'), 'src-FY-fiscal_year', 'a source opens its own evidence page')
  assert.equal(document.querySelectorAll('a').length, 0, 'no link is built from a source locator or id')

  const cashFlow = render(inspection({ inputs: [fact('revenue', '50000000', [
    term('+', 'year_to_date', 'Q3', '2025-08-29', '2026-05-28', '135000000', '10-Q', '2026-06-25'),
    term('-', 'year_to_date', 'Q2', '2025-08-29', '2026-02-26', '85000000', '10-Q', '2026-03-19'),
  ])] }))
  assert.equal(text(cashFlow.querySelector('[data-testid="financial-inspector-formula"]')), 'Derived from filings: Q4 FY2026 = Q3 FY2026 year to date − Q2 FY2026 year to date')
  assert.equal(text(render(inspection({ inputs: [fact('revenue', '54229000000', null)] })).querySelector('[data-testid="financial-inspector-formula"]')), 'As reported in the filing')
})

test('beside other inputs a derivation is one line, and a filing several inputs came from is listed once', () => {
  const document = render(MARGIN)
  assert.equal(text(document.querySelector('[data-testid="financial-inspector-value"]')), '86.76%')
  assert.equal(text(document.querySelector('[data-testid="financial-inspector-formula"]')), 'Gross profit ÷ revenue')
  assert.deepEqual(rows(document), [
    ['Gross profit', 'Q4 FY2026 · ended Sep 2026', '$47.0B'],
    ['Derived: Q4 FY2026 = FY2026 − Q1 FY2026 − Q2 FY2026 − Q3 FY2026'],
    ['Revenue', 'Q4 FY2026 · ended Sep 2026', '$54.2B'],
    ['Derived: Q4 FY2026 = FY2026 − Q1 FY2026 − Q2 FY2026 − Q3 FY2026'],
  ])
  assert.deepEqual(sources(document)[0], '10-K filed Oct 9, 2026 | Gross profit FY2026, Revenue FY2026')
  assert.equal(sources(document).length, 4)
  assert.deepEqual(financialHeading(undefined, MARGIN), { title: 'Gross margin (gross profit / revenue)', subtitle: 'Micron Technology Inc · Q4 FY2026 · ended Sep 2026' })
  assert.deepEqual(financialHeading(undefined, inspection()), { title: 'Revenue', subtitle: 'Micron Technology Inc · Q4 FY2026 · ended Sep 2026' })
})

test('audit material waits under a closed Details, with identifiers shortened and dates in words', () => {
  const document = render(inspection())
  const details = document.querySelector('[data-testid="inspector-details"]')!
  assert.equal(details.hasAttribute('open'), false)
  const cutoff = detail(document, 'Information cutoff')?.querySelector('time')
  assert.deepEqual([text(cutoff), cutoff?.getAttribute('title')], ['Nov 14, 2026, 01:50', '2026-11-14T01:50:04.131Z'])
  const factId = detail(document, 'Fact')?.querySelector('code')
  assert.deepEqual([text(factId), factId?.getAttribute('title')], ['62ce4cc0…', '62ce4cc0-70b2-4124-b57d-92b1179ecc6d'])
  assert.equal(text(detail(document, 'Locator')?.querySelector('code')), 'sec_edgar:de…26-09-03')
  assert.equal(text(detail(document, 'Public by')), 'Nov 12, 2026, 23:46 (instant)')
  assert.equal(text(detail(document, 'FY2026')), '$133.2B · 10-K 0000723125-26-0000Y sec_edgar:co…26-09-03')
  assert.ok(document.querySelector('button[aria-label="Copy the fact ID to the clipboard"]'), 'each identifier copies in full')
  assert.equal(
    [...details.querySelectorAll('p')].at(-1)?.textContent,
    'Subjects: MU · XNAS — Micron Technology Inc (issuer:b6f1d101…). Information public by Nov 14, 2026, 01:50.',
  )
  details.remove()
  const body = document.body.textContent ?? ''
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/u.test(body), `no identifier outside Details: ${body}`)
  assert.ok(!/\d{4}-\d{2}-\d{2}/u.test(body), `no raw date outside Details: ${body}`)
})

const PRICED = inspection({
  payload: { kind: 'value', value: '120', unit: { kind: 'currency_per_share', currency: 'USD' }, exact: true, rounding: null },
  measure: 'Share price',
  definitions: [{ metric_key: 'share_price', definition_version: 'share_price.v1' }],
  inputs: [{
    input_slot: 'px', status: 'bound', observation_id: 'o0000000-0000-4000-8000-000000000001', listing_id: 'l0000000-0000-4000-8000-000000000001', company: 'Micron Technology Inc',
    source: { source_id: 'src-polygon', body_sha256: 'd'.repeat(64) }, metric: { metric_key: 'share_price', definition_version: 'share_price.v1' },
    value: '1200', split_adjustment: { reference_date: '2024-06-10', factor: { numerator: '10', denominator: '1' } }, unit: { kind: 'currency_per_share', currency: 'USD' },
    observation: { kind: 'session_close', observed_at: '2024-06-07T20:00:00.000Z', known_at: '2024-06-07T20:15:00.000Z' },
  }],
})

test('a bound share price shows the observation it came from and the split restating it', () => {
  const document = render(PRICED)
  assert.equal(text(document.querySelector('[data-testid="financial-inspector-value"]')), 'USD 120.00 per share')
  assert.deepEqual(rows(document), [
    ['Share price', 'Session close Jun 7, 2024', 'USD 1,200.00 per share'],
    ['Split basis', '÷ 10/1 to Jun 10, 2024', ''],
  ])
  assert.deepEqual(sources(document), ['Price data | Share price, Jun 7, 2024'])
  assert.equal(text(detail(document, 'Known at')), 'Jun 7, 2024, 20:15')
  assert.equal(text(detail(document, 'Body hash')?.querySelector('code')), 'dddddddddddd…dddddddd')
})

test('an input is named as the answer names its metric', () => {
  const eps = render(inspection({ inputs: [fact('eps_diluted', '11.93', null, { unit: { kind: 'currency_per_share', currency: 'USD' } })] }))
  assert.deepEqual(rows(eps)[0], ['EPS (diluted)', 'Q4 FY2026 · ended Sep 2026', 'USD 11.93 per share'])
  assert.deepEqual(sources(eps), ['Filing | EPS (diluted) Q4 FY2026'])
  assert.equal(text([...eps.querySelectorAll('[data-testid="inspector-details"] h4')].find((title) => title.textContent?.startsWith('EPS'))), 'EPS (diluted) Q4 FY2026')
})

test('a figure standing in for another metric says what it equals and why', () => {
  const inferred = render(inspection({
    inputs: [fact('net_income_consolidated', '54229000000', null, { inference: { kind: 'no_noncontrolling_interest', concept: 'NetIncomeLoss', checked: ['MinorityInterest'] } })],
  }))
  assert.equal(rows(inferred).at(-1)?.[0], 'Inferred: Equal to NetIncomeLoss: the filer reports no noncontrolling interest for this period.')
  assert.ok(!(render(inspection()).body.textContent ?? '').includes('Inferred'), 'a figure a filing states shows no inference')
})

test('a tiny ratio keeps its exact canonical text and a P/E reads as a multiple', () => {
  const small = render(inspection({ payload: { kind: 'value', value: '0.000000000000000001', unit: { kind: 'ratio' }, exact: true, rounding: null }, formula: { operation: 'gross_margin', operation_version: 'gross_margin.v1', numeric_policy_version: 'numeric.v1', reads_as_multiple: false } }))
  assert.equal(text(small.querySelector('[data-testid="financial-inspector-value"]')), '0.00%')
  assert.equal(text(small.querySelector('[data-testid="financial-inspector-exact"]')), '0.000000000000000001')
  assert.equal(text(detail(small, 'Numeric policy')), 'numeric.v1')
  const pe = render(inspection({ payload: { kind: 'value', value: '25', unit: { kind: 'ratio' }, exact: true, rounding: null }, formula: { operation: 'pe_ratio', operation_version: 'pe_ratio.v1', numeric_policy_version: 'numeric.v1', reads_as_multiple: true } }))
  assert.equal(text(pe.querySelector('[data-testid="financial-inspector-value"]')), '25.00x')
  assert.equal(text(pe.querySelector('[data-testid="financial-inspector-formula"]')), 'Share price ÷ diluted EPS')
})

test('a change in a leverage ratio reads as a multiple, as the answer table prints it', () => {
  const change = render(inspection({
    payload: { kind: 'value', value: '0.3', unit: { kind: 'ratio' }, exact: true, rounding: null },
    formula: { operation: 'absolute_change', operation_version: 'absolute_change.v2', numeric_policy_version: 'numeric.v1', reads_as_multiple: true },
  }))
  assert.equal(text(change.querySelector('[data-testid="financial-inspector-value"]')), '0.30x')
  const margin = render(inspection({
    payload: { kind: 'value', value: '0.3', unit: { kind: 'ratio' }, exact: true, rounding: null },
    formula: { operation: 'absolute_change', operation_version: 'absolute_change.v2', numeric_policy_version: 'numeric.v1', reads_as_multiple: false },
  }))
  assert.equal(text(margin.querySelector('[data-testid="financial-inspector-value"]')), '30.00%', 'a change in a margin stays a percentage')
})

test('Copy puts on the clipboard exactly the exact text the page shows', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
  const restoreGlobals = installDomGlobals(dom.window as unknown as Window)
  const copied: string[] = []
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (value: string) => void copied.push(value) }, configurable: true })
  try {
    const root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => root.render(<FinancialResultInspector load={{ kind: 'ready', inspection: MARGIN }} />))
    const exact = dom.window.document.querySelector('[data-testid="financial-inspector-exact"]')
    await act(async () => (dom.window.document.querySelector('button[aria-label="Copy the exact value to the clipboard"]') as HTMLButtonElement).click())
    assert.deepEqual(copied, ['0.86756163676261778753065702852717180844197753969278'])
    assert.equal(exact?.textContent, copied[0])
    await act(async () => root.unmount())
  } finally {
    delete (globalThis.navigator as { clipboard?: unknown }).clipboard
    restoreGlobals()
  }
})

const ALPHA = fact('revenue', '300000000000', null, { input_slot: 'a_rev', company: 'Alpha Industries Inc.', source: { source_id: 'src-alpha', document_id: null, source_version_hash: 'v'.repeat(64), locator: null, filed: '2024-01-10' } })
const BETA = fact('revenue', '200000000000', null, { input_slot: 'b_rev', company: 'Beta Holdings Corp.', source: { source_id: 'src-beta', document_id: null, source_version_hash: 'v'.repeat(64), locator: null, filed: '2024-02-14' } })

test('inputs from two companies each name their company, and a filing a stated value came from is named by its filed date', () => {
  const spread = render(inspection({
    payload: { kind: 'value', value: '100000000000', unit: USD, exact: true, rounding: null },
    formula: { operation: 'spread', operation_version: 'spread.v1', numeric_policy_version: 'numeric.v1', reads_as_multiple: false },
    measure: 'Difference in Revenue',
    inputs: [ALPHA, BETA],
  }))
  assert.deepEqual(rows(spread), [
    ['Alpha Industries Inc. · Revenue', 'Q4 FY2026 · ended Sep 2026', '$300.0B'],
    ['Beta Holdings Corp. · Revenue', 'Q4 FY2026 · ended Sep 2026', '$200.0B'],
  ])
  assert.deepEqual(sources(spread), ['Alpha Industries Inc. · Filed Jan 10, 2024 | Revenue Q4 FY2026', 'Beta Holdings Corp. · Filed Feb 14, 2024 | Revenue Q4 FY2026'])
  assert.deepEqual([...spread.querySelectorAll('tbody td.num [title]')].map((cell) => [cell.textContent, cell.getAttribute('title'), cell.getAttribute('aria-label')]), [
    ['$300.0B', 'USD 300000000000', 'USD 300000000000'],
    ['$200.0B', 'USD 200000000000', 'USD 200000000000'],
  ], 'each rounded input keeps its exact amount for hover and assistive tech')
  const one = render(inspection({ inputs: [ALPHA] }))
  assert.deepEqual(rows(one), [['Revenue', 'Q4 FY2026 · ended Sep 2026', '$300.0B']], 'one company is not repeated on its rows')
  assert.deepEqual(sources(one), ['Filed Jan 10, 2024 | Revenue Q4 FY2026'])
  assert.deepEqual(sources(render(inspection({ inputs: [fact('revenue', '1', null)] }))), ['Filing | Revenue Q4 FY2026'], 'with no filed date it is a filing')
  const shared = render(inspection({ inputs: [
    fact('gross_profit', '1', null, { source: { source_id: 'src-FY-fiscal_year', document_id: null, source_version_hash: 'v'.repeat(64), locator: null, filed: '2026-10-09' } }),
    fact('revenue', '54229000000', Q4_TERMS),
  ] }))
  assert.equal(sources(shared)[0], '10-K filed Oct 9, 2026 | Gross profit Q4 FY2026, Revenue FY2026', 'a filing a derivation names by its form keeps that name')
})

test('the heading fills what a click did not say from the inspection, and names no single period for a result read across several', () => {
  const ttm = inspection({
    formula: { operation: 'trailing_sum', operation_version: 'trailing_sum.v1', numeric_policy_version: 'numeric.v1', reads_as_multiple: false },
    measure: 'Revenue, trailing four quarters',
    inputs: ['Q1', 'Q2', 'Q3', 'Q4'].map((quarter) => fact('revenue', '1', null, { input_slot: `a_${quarter}`, period: { kind: 'duration', start: null, end: '2026-09-03', fiscal_year: 2026, fiscal_period: quarter } })),
  })
  assert.deepEqual(financialHeading(undefined, ttm), { title: 'Revenue, trailing four quarters', subtitle: 'Micron Technology Inc' })
  const leverage = inspection({ formula: { operation: 'ratio', operation_version: 'ratio.v1', numeric_policy_version: 'numeric.v1', reads_as_multiple: true }, measure: 'Net debt / EBITDA' })
  assert.equal(financialHeading(undefined, leverage).title, 'Net debt / EBITDA', 'a named ratio is titled by its name')
  const spread = inspection({ measure: 'Difference in Revenue', inputs: [ALPHA, { ...BETA, period: { ...BETA.period, fiscal_year: 2025 } }] })
  assert.deepEqual(financialHeading(undefined, spread), { title: 'Difference in Revenue', subtitle: 'Verified calculation' }, 'two companies and two periods: neither is one of them')
  const halfGap = inspection({ measure: 'Difference in Revenue', inputs: [ALPHA, { input_slot: 'b_rev', status: 'gap', reason_code: 'not_public_at_cutoff' }] })
  assert.deepEqual(financialHeading(undefined, halfGap), { title: 'Difference in Revenue', subtitle: 'Verified calculation' }, 'a gap input may be another company or period, so none is named')
  assert.deepEqual(
    financialHeading({ subject: null, measure: null, period: 'Q4 FY2026', value: '$54.2B' }, inspection()),
    { title: 'Revenue', subtitle: 'Micron Technology Inc · Q4 FY2026' },
    'commentary names its period; the inspection names the rest',
  )
  assert.deepEqual(
    financialHeading({ subject: 'Micron Technology Inc', measure: 'Revenue', period: 'Q4 FY2026', value: '$54.2B' }, null),
    { title: 'Revenue', subtitle: 'Micron Technology Inc · Q4 FY2026' },
    'a clicked cell heads the page before the inspection loads',
  )
})

test('a date-precision publication and a session close read as their day, wherever the reader is', () => {
  const previous = process.env.TZ
  process.env.TZ = 'Asia/Singapore'
  try {
    const dated = render(inspection({ inputs: [fact('revenue', '1', null, { publication: { attestation_id: 'b90a68a4-6e56-4184-8c99-876b9a485fcb', available_no_later_than: '2026-02-28T04:59:59.999Z', precision: 'date', source_timezone: 'America/New_York' } })] }))
    assert.equal(text(detail(dated, 'Public by')), 'Feb 27, 2026 (date)')
    const close = render(PRICED)
    assert.deepEqual(rows(close)[0], ['Share price', 'Session close Jun 7, 2024', 'USD 1,200.00 per share'])
    assert.deepEqual(sources(close), ['Price data | Share price, Jun 7, 2024'])
  } finally {
    process.env.TZ = previous
  }
})

test('predicates, partial rankings, and gaps say what they are', () => {
  assert.equal(payloadSummary({ kind: 'predicate', predicate: 'threshold', comparison: 'gt', outcome: true }), 'Met (gt)')
  assert.equal(payloadSummary({ kind: 'ranking', complete: false }, 'peer_compare'), 'Partial ranking: not every requested company has a value')
  assert.equal(payloadSummary({ kind: 'ranking', complete: false }, 'period_rank'), 'Partial ranking: not every period has a value')
  assert.equal(payloadSummary({ kind: 'gap', reason_code: 'stale_input' }), 'Not available (stale_input)')
  const ranking = render(inspection({ payload: { kind: 'ranking', complete: true }, coverage_state: 'partial', inputs: [...inspection().inputs, { input_slot: 'b_rev', status: 'gap', reason_code: 'not_public_at_cutoff' }] }))
  assert.equal(text(ranking.querySelector('[data-testid="financial-inspector-value"]')), 'Complete ranking')
  assert.equal(ranking.querySelector('[data-testid="financial-inspector-exact"]'), null, 'only a value has an exact form to copy')
  assert.ok((ranking.body.textContent ?? '').includes('Partial coverage'))
  assert.deepEqual(rows(ranking).at(-1), ['No eligible input', 'Not public at cutoff', 'n/a'])
})

test('an unknown or legacy version is legacy output, never verified values', () => {
  for (const legacy of [
    { schema_version: SUPPORTED_INSPECTION_SCHEMA_VERSION, availability: 'unsupported_version', result_id: 'r', run_id: 'u', reason_code: 'unsupported_version' } as const,
    inspection({ schema_version: 'financial_result_inspection.v9' }),
  ]) {
    const html = renderToStaticMarkup(<FinancialResultInspector load={{ kind: 'ready', inspection: legacy }} />)
    assert.ok(html.includes('Legacy output'))
    assert.ok(!html.includes('Verified calculation') && !html.includes('54.2B') && !html.includes('54229000000'))
    assert.ok(!html.includes('Pinned replay'), 'pinned replay is offered only for a result this client fully understands')
    assert.deepEqual(financialHeading(undefined, legacy), { title: 'Verified calculation', subtitle: 'Verified calculation' })
  }
})

test('loading and error states are announced', () => {
  assert.match(renderToStaticMarkup(<FinancialResultInspector load={{ kind: 'loading', resultId: 'r' }} />), /role="status"/u)
  const error = renderToStaticMarkup(<FinancialResultInspector load={{ kind: 'error', resultId: 'r', message: 'This calculation is not available to inspect.' }} />)
  assert.match(error, /role="alert"[^>]*>This calculation is not available to inspect\./u)
})

test('a scenario result lists the P/E it read as the user\'s assumption, after the reported inputs', () => {
  const assumption = { assumption_id: 'pe_base', scenario: 'base', value: '25', attribution: { kind: 'user_request', ref: 'chat:thread:turn', captured_at: '2024-06-10T14:00:00.000Z' }, assumption_hash: 'd'.repeat(64) } as const
  const document = render(inspection({ schema_version: INSPECTION_V2_SCHEMA_VERSION, assumptions: [assumption] }))
  const section = document.querySelector('[data-testid="financial-inspector-assumptions"]')!
  assert.equal(text(section.querySelector('h3')), 'Assumptions (user-supplied, not reported data)')
  assert.equal(text(section.querySelector('li')), 'Base P/E 25 Your assumptionStated Jun 10, 2024, 14:00')
  assert.equal(text(detail(document, 'Stated in')?.querySelector('code')), 'chat:thread:turn')
  assert.equal(text(detail(document, 'Hash')?.querySelector('code')), 'dddddddddddd…dddddddd')
  const html = document.body.innerHTML
  assert.ok(html.indexOf('How it was computed') < html.indexOf('Assumptions (user-supplied'), 'assumptions follow the reported inputs')
  assert.equal(render(inspection()).querySelector('[data-testid="financial-inspector-assumptions"]'), null, 'a v1 inspection has none')
})
