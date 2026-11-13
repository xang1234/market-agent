import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'

import { EvidenceInspectorContext, type EvidenceInspectorContextValue } from '../evidence/evidenceInspectorContext.ts'

import { validateBlock } from './BlockValidator.ts'
import { BlockProofContext, type BlockProof } from './blockProof.ts'
import { FinancialAnswer } from './FinancialAnswer.tsx'
import { resultsById, seriesBars, sortedRowIndexes } from './financialAnswer.ts'
import { readFileSync } from 'node:fs'
import { financialAnswerFiscalCalendarsFixture, financialAnswerFixture, financialAnswerScenariosFixture } from './fixtures.ts'
import type { FinancialAnswerBlock, FinancialAnswerContent, FinancialPresentedResult, FinancialTablePresentation } from './types.ts'

function clone(): FinancialAnswerBlock & { financial: FinancialAnswerContent } {
  return JSON.parse(JSON.stringify(financialAnswerFixture))
}

function content(block: FinancialAnswerBlock): FinancialAnswerContent {
  return block.financial as FinancialAnswerContent
}

function table(block: FinancialAnswerBlock): FinancialTablePresentation {
  const found = content(block).presentations.find((presentation) => presentation.kind === 'table')
  assert.ok(found && found.kind === 'table')
  return found
}

test('the fixture passes the canonical block schema', () => {
  const result = validateBlock(financialAnswerFixture)
  assert.ok(result.valid, JSON.stringify(!result.valid && result.errors))
})

test('the schema rejects model prose: a title, an extra narrative field, or a comparative word in a value', () => {
  const titled = { ...clone(), title: 'Apple has the highest margin' }
  assert.equal(validateBlock(titled).valid, false, 'no title in the certified lane')

  const narrated = clone() as unknown as Record<string, unknown>
  ;(narrated.financial as Record<string, unknown>).narrative = 'Apple is the highest'
  assert.equal(validateBlock(narrated).valid, false, 'no free-text content field')

  const annotated = clone()
  const value = annotated.financial.results[1]!.presented
  assert.ok(value.kind === 'value')
  ;(value as { text: string }).text = '46.21% (highest)'
  assert.equal(validateBlock(annotated).valid, false, 'a value label is a formatted number only')

  const inlineResult = clone()
  ;(inlineResult.financial.results[0] as unknown as Record<string, unknown>).note = 'doubled'
  assert.equal(validateBlock(inlineResult).valid, false, 'results carry no extra text')
})

test('the schema forbids naming a leader for an incomplete ranking', () => {
  const block = clone()
  const ranking = block.financial.results[4]!.presented
  assert.ok(ranking.kind === 'ranking' && ranking.complete === false)
  ;(ranking as { leader_label_ids: string[] | null }).leader_label_ids = ['subject:a']
  assert.equal(validateBlock(block).valid, false)
})

test('an unknown presentation version passes the schema but renders a notice and no values', () => {
  const block = { ...clone(), financial: { presentation_version: 'financial-presentation.v9', results: [{ text: 'USD 1.00' }] } } as FinancialAnswerBlock
  assert.ok(validateBlock(block).valid, 'newer servers can still deliver the block')
  const html = renderToStaticMarkup(<FinancialAnswer block={block} />)
  assert.match(html, /data-certified="false"/)
  assert.match(html, /newer format than this app supports/)
  assert.doesNotMatch(html, /USD|%/)
})

test('a supported answer prints server strings with full values, coverage, and an accessible table', () => {
  const html = renderToStaticMarkup(<FinancialAnswer block={financialAnswerFixture} />)
  assert.match(html, /data-certified="true"/)
  assert.match(html, /data-coverage="partial"[^>]*>4 of 5 requested results verified</)
  assert.match(html, /<caption[^>]*>Revenue, Gross margin \(gross profit \/ revenue\) by company<\/caption>/)
  assert.match(html, /<th scope="col"[^>]*>Company<\/th>/)
  assert.match(html, /<th scope="row"[^>]*>Apple Inc\.<span class="block text-xs text-muted">FY2023<\/span><\/th>/, 'the row names its one period once')
  assert.match(html, /title="46\.206%" aria-label="46\.206%">46\.21%</, 'rounded label with the exact value for tooltips and assistive tech')
  assert.match(html, /title="A required input or calculation is unavailable\."><span aria-hidden="true">n\/a<\/span>/, 'a gap is shown as a gap')
  assert.match(html, /Not requested/, 'a cell outside the request is explicit')
  assert.match(html, /Ranked 1 of 2 companies; no overall highest can be stated for an incomplete group/)
  assert.match(html, /at or above 40\.00%: yes/)
  assert.doesNotMatch(html, /figcaption/, 'no model-supplied title')
})

test('a comparison across fiscal calendars has one column per line, each cell naming its own period in visible text', () => {
  const inspector: EvidenceInspectorContextValue = { openInspection() {}, openBlockInspection() {}, openFinancialResult() {}, closeInspection() {} }
  const html = renderToStaticMarkup(
    <EvidenceInspectorContext.Provider value={inspector}>
      <FinancialAnswer block={financialAnswerFiscalCalendarsFixture} />
    </EvidenceInspectorContext.Provider>,
  )
  const table = new JSDOM(html).window.document.querySelector('table')!
  assert.deepEqual([...table.querySelectorAll('thead th')].map((heading) => heading.textContent), [
    'Company',
    'Revenue',
    'Gross profit',
    'Operating income',
    'Net income',
    'Gross margin',
    'Operating margin',
    'Net margin',
    'Quarter-over-quarter percent change in Revenue',
    'Year-over-year percent change in Revenue',
  ])
  const rows = [...table.querySelectorAll('tbody tr')].map((row) => [
    row.querySelector('th')!.textContent,
    ...[...row.querySelectorAll('td')].map((cell) => [...cell.children].map((part) => part.querySelector('[aria-hidden="true"]')?.textContent ?? part.textContent)),
  ])
  assert.deepEqual(rows, [
    [
      'NVIDIA Corp',
      ['$68.0B', 'Q4 FY2026'],
      ['$51.0B', 'Q4 FY2026'],
      ['$44.2B', 'Q4 FY2026'],
      ['$37.4B', 'Q4 FY2026'],
      ['75.00%', 'Q4 FY2026'],
      ['65.00%', 'Q4 FY2026'],
      ['55.00%', 'Q4 FY2026'],
      ['19.30%', 'Q4 FY2026 vs Q3 FY2026'],
      ['73.20%', 'Q4 FY2026 vs Q4 FY2025'],
    ],
    [
      'Advanced Micro Devices, Inc.',
      ['$7.7B', 'Q2 FY2026'],
      ['$3.1B', 'Q2 FY2026'],
      ['$770.0M', 'Q2 FY2026'],
      ['$693.0M', 'Q2 FY2026'],
      ['40.00%', 'Q2 FY2026'],
      ['10.00%', 'Q2 FY2026'],
      ['9.00%', 'Q2 FY2026'],
      ['4.80%', 'Q2 FY2026 vs Q1 FY2026'],
      ['n/a'],
    ],
  ])
  assert.doesNotMatch(html, /Not requested/)
  assert.equal(table.querySelector('tbody td button')!.getAttribute('aria-label'), 'Inspect the verified calculation for USD 68000000000, Q4 FY2026')
  const plain = renderToStaticMarkup(<FinancialAnswer block={financialAnswerFiscalCalendarsFixture} />)
  assert.match(plain, /title="USD 7700000000" aria-label="USD 7700000000">\$7\.7B<\/span><span class="block text-xs text-muted">Q2 FY2026<\/span>/, 'the value keeps its own label; the period is ordinary text after it')
})

test('a row whose cells read one period names it once under its company, and a gap reads n/a with its reason kept', () => {
  const block = structuredClone(financialAnswerFiscalCalendarsFixture) as FinancialAnswerBlock & { financial: FinancialAnswerContent }
  const reason = 'No eligible input was public before the knowledge cutoff.'
  const labels = block.financial.labels as Record<string, { kind: string; text: string }>
  labels['period:p0'] = { kind: 'period', text: 'FY2026 (ended 2026-09-03)' }
  labels['period:p3'] = { kind: 'period', text: 'FY2026 (ended 2026-07-03)' }
  const net = block.financial.results.find((result) => result.result_id.endsWith('000000000013'))!
  Object.assign(net, { disposition: 'missing', presented: { kind: 'gap', text: reason, reason_code: 'missing_input' } })
  const table = block.financial.presentations[0] as FinancialTablePresentation
  Object.assign(table, { columns: table.columns.slice(0, 7), rows: table.rows.map((row) => ({ ...row, cells: row.cells.slice(0, 7) })) })
  const html = renderToStaticMarkup(<FinancialAnswer block={block} />)
  const document = new JSDOM(html).window.document
  const visible = (element: Element) => [...element.childNodes].map((node) => (node as Element).classList?.contains('sr-only') ? '' : node.textContent).join('')
  assert.equal(document.querySelector('caption')!.className, 'sr-only', 'the caption is for screen readers')
  assert.deepEqual([...document.querySelectorAll('thead th')].map((heading) => [heading.textContent, heading.querySelector('button')?.getAttribute('title') ?? null]), [
    ['Company', null],
    ['Revenue', null],
    ['Gross profit', null],
    ['Operating income', null],
    ['Net income', null],
    ['Gross margin', 'Gross margin (gross profit / revenue)'],
    ['Operating margin', 'Operating margin (operating income / revenue)'],
    ['Net margin', 'Net margin (net income / revenue)'],
  ])
  const rows = [...document.querySelectorAll('tbody tr')].map((row) => [
    [...row.querySelector('th')!.childNodes].map((node) => node.textContent),
    ...[...row.querySelectorAll('td')].map((cell) => visible(cell.firstElementChild!)),
  ])
  assert.deepEqual(rows, [
    [['NVIDIA Corp', 'FY2026 · ended Sep 2026'], '$68.0B', '$51.0B', '$44.2B', '$37.4B', '75.00%', '65.00%', '55.00%'],
    [['Advanced Micro Devices, Inc.', 'FY2026 · ended Jul 2026'], '$7.7B', '$3.1B', '$770.0M', 'n/a', '40.00%', '10.00%', '9.00%'],
  ])
  const gap = document.querySelectorAll('tbody tr')[1]!.querySelectorAll('td')[3]!.firstElementChild!
  assert.equal(gap.getAttribute('title'), reason)
  assert.equal(gap.querySelector('.sr-only')!.textContent, reason, 'a screen reader hears the reason')
  assert.equal(gap.querySelector('[aria-hidden="true"]')!.textContent, 'n/a')
})

test('sorting uses the server exact order; descending keeps rows without a value last', () => {
  const block = clone()
  const presentation: FinancialTablePresentation = {
    ...table(block),
    rows: [
      { subject_label_id: 'subject:a', cells: [null, '92222222-2222-4222-9222-222222222222'] },
      { subject_label_id: 'subject:b', cells: [null, '93333333-3333-4333-9333-333333333333'] },
      { subject_label_id: 'subject:c', cells: [null, '96666666-6666-4666-9666-666666666666'] },
    ],
    ascending: { c0: [0, 1, 2], c1: [2, 0, 1] },
  }
  const results = new Map(resultsById(content(block)))
  results.set('96666666-6666-4666-9666-666666666666', {
    ...content(block).results[1]!,
    result_id: '96666666-6666-4666-9666-666666666666',
    presented: { kind: 'value', text: '46.21%', full_text: '46.2059%', value: '0.462059', unit: { kind: 'ratio' }, exact: true },
  })
  assert.deepEqual(sortedRowIndexes(presentation, results, 'c1', 'ascending'), [2, 0, 1], 'equal labels, exact order')
  assert.deepEqual(sortedRowIndexes(presentation, results, 'c1', 'descending'), [0, 2, 1], 'the gap row stays last')
  assert.deepEqual(sortedRowIndexes({ ...presentation, ascending: { c1: [0, 0, 1] } }, results, 'c1', 'ascending'), [0, 1, 2], 'an invalid permutation falls back to server order')
})

test('series bars are bounded, carry their sign, and skip gaps and non-finite values', () => {
  const value = (text: string): FinancialPresentedResult => ({
    result_id: 'x', output_id: 'o', disposition: 'verified', subject_label_id: null, measure_label_id: 'measure:m0', period_label_id: 'period:p0', result_hash: '',
    presented: { kind: 'value', text, full_text: text, value: text, unit: { kind: 'count' }, exact: true },
  })
  const gap = content(financialAnswerFixture).results[2]!
  assert.deepEqual(seriesBars([value('50'), value('-100'), gap, undefined, value('1e999')]), [
    { size: 0.5, negative: false },
    { size: 1, negative: true },
    null,
    null,
    null,
  ])
  assert.deepEqual(seriesBars([value('0'), value('0')]), [
    { size: 0, negative: false },
    { size: 0, negative: false },
  ])
})

const quietInspector: EvidenceInspectorContextValue = { openInspection() {}, openBlockInspection() {}, openFinancialResult() {}, closeInspection() {} }

test('P/E scenarios label the EPS as source-linked and each P/E as the user\'s, with the disclosure and no other badge', () => {
  assert.ok(validateBlock(financialAnswerScenariosFixture).valid, 'the v3 fixture passes the canonical block schema')
  const html = renderToStaticMarkup(
    <EvidenceInspectorContext.Provider value={quietInspector}>
      <FinancialAnswer block={financialAnswerScenariosFixture} />
    </EvidenceInspectorContext.Provider>,
  )
  const document = new JSDOM(html).window.document
  assert.deepEqual([...document.querySelectorAll('[data-verification]')].map((label) => [label.getAttribute('data-verification'), label.textContent]), [
    ['verified', 'Verified calculation'],
    ['source_linked', 'Source-linked'],
    ['user_supplied', 'Your assumption'],
  ])
  const eps = document.querySelector('[data-testid$="-scenarios"] > p')!
  assert.deepEqual([eps.querySelector('[data-verification]')?.getAttribute('data-verification'), eps.querySelector('.num')?.textContent], ['source_linked', 'USD 4.00 per share'])
  const table = document.querySelector('[data-testid$="-scenarios"] table')!
  assert.deepEqual([...table.querySelectorAll('thead th')].map((heading) => heading.textContent), ['Scenario', 'P/E Your assumption', 'Value per share'])
  assert.deepEqual([...table.querySelectorAll('tbody tr')].map((row) => [...row.children].map((cell) => cell.textContent)), [
    ['Bear', '20xYour assumption in this request (2024-01-15 15:00 UTC)', 'USD 80.00 per share'],
    ['Base', '25xYour assumption in this request (2024-01-15 15:00 UTC)', 'USD 100.00 per share'],
    ['Bull', '30xYour assumption in this request (2024-01-15 15:00 UTC)', 'USD 120.00 per share'],
  ])
  assert.equal(document.querySelector('[role="note"]')?.textContent, 'A mechanical scenario: reported diluted EPS × a P/E you supplied. Not a price target, forecast, or recommendation.')
  assert.equal(document.querySelectorAll('[data-inspect-result]').length, 4, 'the EPS and each scenario value open the inspector')
})

test('the EPS is labelled source-linked only when it is a value whose block proof links its evidence', () => {
  const labels = (block: FinancialAnswerBlock, proof: BlockProof | null) => {
    const html = renderToStaticMarkup(
      <BlockProofContext.Provider value={proof}>
        <EvidenceInspectorContext.Provider value={quietInspector}>
          <FinancialAnswer block={block} />
        </EvidenceInspectorContext.Provider>
      </BlockProofContext.Provider>,
    )
    const eps = new JSDOM(html).window.document.querySelector('[data-testid$="-scenarios"] > p')!
    return [eps.getAttribute('data-result-kind'), [...eps.querySelectorAll('[data-verification]')].map((label) => label.getAttribute('data-verification'))]
  }
  const linked: BlockProof = { evidence: 'linked', calculation: 'verified', public_by_cutoff: 'proven' }
  const unverified: BlockProof = { evidence: 'unknown', calculation: 'not_verified', public_by_cutoff: 'unknown' }
  const scenarios = content(financialAnswerScenariosFixture)
  const missingEps: FinancialAnswerBlock = {
    ...financialAnswerScenariosFixture,
    financial: {
      ...scenarios,
      results: scenarios.results.map((result, index) => index === 0
        ? { ...result, disposition: 'missing', presented: { kind: 'gap', text: 'A required input or calculation is unavailable.', reason_code: 'missing_input' } }
        : result),
    },
  } as FinancialAnswerBlock
  assert.deepEqual([
    labels(financialAnswerScenariosFixture, linked),
    labels(financialAnswerScenariosFixture, null),
    labels(financialAnswerScenariosFixture, unverified),
    labels(missingEps, linked),
  ], [
    [null, ['source_linked']],
    [null, ['source_linked']],
    [null, []],
    ['gap', []],
  ])
})

test('a v2 answer renders byte for byte as it did before scenarios', () => {
  const html = renderToStaticMarkup(
    <EvidenceInspectorContext.Provider value={quietInspector}>
      <FinancialAnswer block={financialAnswerFixture} />
    </EvidenceInspectorContext.Provider>,
  )
  assert.equal(html, readFileSync(new URL('./financialAnswer.v2.golden.html', import.meta.url), 'utf8'), 'captured before the renderer changed')
})
