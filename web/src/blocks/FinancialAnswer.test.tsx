import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'

import { EvidenceInspectorContext, type EvidenceInspectorContextValue } from '../evidence/evidenceInspectorContext.ts'

import { validateBlock } from './BlockValidator.ts'
import { BlockProofContext, type BlockProof } from './blockProof.ts'
import { FinancialAnswer } from './FinancialAnswer.tsx'
import { columnNames, groupStarts, resultShown, resultsById, seriesBars, shortNames, sortedRowIndexes } from './financialAnswer.ts'
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
  assert.match(html, /<th scope="row"[^>]*><span title="Apple Inc\.">Apple<\/span><span class="block text-xs font-normal text-muted">FY2023<\/span><\/th>/, 'the row names its company short, its full name on hover, and its one period once')
  assert.match(html, /title="46\.206%" aria-label="46\.206%">46\.21%</, 'rounded label with the exact value for tooltips and assistive tech')
  assert.match(html, /title="A required input or calculation is unavailable\."><span aria-hidden="true">n\/a<\/span>/, 'a gap is shown as a gap')
  assert.match(html, /Not requested/, 'a cell outside the request is explicit')
  assert.match(html, /Ranked 1 of 2 companies; no overall highest can be stated for an incomplete group/)
  assert.match(html, /at or above 40\.00%: yes/)
  assert.doesNotMatch(html, /figcaption/, 'no model-supplied title')
})

test('a comparison across fiscal calendars has one column per line, each row naming its period once and each change its base', () => {
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
    'QoQ revenue',
    'YoY revenue',
  ])
  const rows = [...table.querySelectorAll('tbody tr')].map((row) => [
    [...row.querySelector('th')!.childNodes].map((node) => node.textContent),
    ...[...row.querySelectorAll('td')].map((cell) => [...cell.children].map((part) => part.querySelector('[aria-hidden="true"]')?.textContent ?? part.textContent)),
  ])
  assert.deepEqual(rows, [
    [
      ['NVIDIA', 'Q4 FY2026'],
      ['$68.0B'],
      ['$51.0B'],
      ['$44.2B'],
      ['$37.4B'],
      ['75.00%'],
      ['65.00%'],
      ['55.00%'],
      ['19.30%', 'vs Q3 FY2026'],
      ['73.20%', 'vs Q4 FY2025'],
    ],
    [
      ['Advanced Micro Devices', 'Q2 FY2026'],
      ['$7.7B'],
      ['$3.1B'],
      ['$770.0M'],
      ['$693.0M'],
      ['40.00%'],
      ['10.00%'],
      ['9.00%'],
      ['4.80%', 'vs Q1 FY2026'],
      ['n/a', 'vs Q2 FY2025'],
    ],
  ])
  assert.doesNotMatch(html, /Not requested/)
  assert.equal(table.querySelector('tbody td button')!.getAttribute('aria-label'), 'Inspect the verified calculation for USD 68000000000, Q4 FY2026')
  const plain = renderToStaticMarkup(<FinancialAnswer block={financialAnswerFiscalCalendarsFixture} />)
  assert.match(plain, /aria-label="4\.8%">4\.80%<\/span><span class="block text-xs text-muted" title="Q2 FY2026 vs Q1 FY2026">vs Q1 FY2026<\/span>/, 'the value keeps its own label; its base is ordinary text after it, the whole period its title')
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
    [['NVIDIA', 'FY2026 · ended Sep 2026'], '$68.0B', '$51.0B', '$44.2B', '$37.4B', '75.00%', '65.00%', '55.00%'],
    [['Advanced Micro Devices', 'FY2026 · ended Jul 2026'], '$7.7B', '$3.1B', '$770.0M', 'n/a', '40.00%', '10.00%', '9.00%'],
  ])
  const gap = document.querySelectorAll('tbody tr')[1]!.querySelectorAll('td')[3]!.firstElementChild!
  assert.equal(gap.getAttribute('title'), reason)
  assert.equal(gap.querySelector('.sr-only')!.textContent, reason, 'a screen reader hears the reason')
  assert.equal(gap.querySelector('[aria-hidden="true"]')!.textContent, 'n/a')
})

test('a gap for another period than its row names that period, so the missing figure is identified', () => {
  const block = structuredClone(financialAnswerFiscalCalendarsFixture) as FinancialAnswerBlock & { financial: FinancialAnswerContent }
  const labels = block.financial.labels as Record<string, { kind: string; text: string }>
  labels['period:p3'] = { kind: 'period', text: 'FY2026 (ended 2026-07-03)' }
  labels['period:p9'] = { kind: 'period', text: 'FY2025 (ended 2025-06-27)' }
  const net = block.financial.results.find((result) => result.result_id.endsWith('000000000013'))!
  Object.assign(net, { disposition: 'missing', period_label_id: 'period:p9', presented: { kind: 'gap', text: 'No eligible input was public before the knowledge cutoff.', reason_code: 'missing_input' } })
  const table = block.financial.presentations[0] as FinancialTablePresentation
  Object.assign(table, { columns: table.columns.slice(0, 7), rows: table.rows.map((row) => ({ ...row, cells: row.cells.slice(0, 7) })) })
  const document = new JSDOM(renderToStaticMarkup(<FinancialAnswer block={block} />)).window.document
  const row = document.querySelectorAll('tbody tr')[1]!
  assert.deepEqual([...row.querySelector('th')!.childNodes].map((node) => node.textContent), ['Advanced Micro Devices', 'FY2026 · ended Jul 2026'])
  const cells = [...row.querySelectorAll('td')].map((cell) => [...cell.children].map((child) => child.querySelector('[aria-hidden="true"]')?.textContent ?? child.textContent))
  assert.deepEqual(cells[3], ['n/a', 'FY2025 · ended Jun 2025'])
  assert.deepEqual(cells[2], ['$770.0M'], 'a value of the row period names none')
})

function amdGaps(onePeriod: boolean): Document {
  const block = structuredClone(financialAnswerFiscalCalendarsFixture) as FinancialAnswerBlock & { financial: FinancialAnswerContent }
  const amd = (block.financial.presentations[0] as FinancialTablePresentation).rows[1]!.cells
  const own = block.financial.results.find((entry) => entry.result_id === amd[0])!.period_label_id
  amd.forEach((id, index) => {
    const result = block.financial.results.find((entry) => entry.result_id === id)!
    Object.assign(result, {
      disposition: 'missing',
      presented: { kind: 'gap', text: index < 7 ? 'No eligible input was public before the knowledge cutoff.' : 'A required input or calculation is unavailable.', reason_code: 'missing_input' },
      ...(onePeriod ? { period_label_id: own } : {}),
    })
  })
  return new JSDOM(renderToStaticMarkup(<FinancialAnswer block={block} />)).window.document
}

test('a row of gaps whose changes name other bases keeps a cell per gap, so each missing comparison keeps its base', () => {
  const row = [...amdGaps(false).querySelectorAll('tbody tr')][1]!
  const cells = [...row.querySelectorAll('td')]
  assert.equal(cells.length, 9)
  assert.deepEqual(cells.slice(7).map((cell) => cell.textContent), ['n/aA required input or calculation is unavailable.vs Q1 FY2026', 'n/aA required input or calculation is unavailable.vs Q2 FY2025'])
})

test('a row with no value reads n/a once across its columns, with each distinct reason and its period said once', () => {
  const cutoff = 'No eligible input was public before the knowledge cutoff.'
  const unavailable = 'A required input or calculation is unavailable.'
  const document = amdGaps(true)
  const [nvda, row] = [...document.querySelectorAll('tbody tr')]
  assert.deepEqual([...row!.querySelector('th')!.childNodes].map((node) => node.textContent), ['Advanced Micro Devices', 'Q2 FY2026'])
  const cells = [...row!.querySelectorAll('td')]
  assert.deepEqual(cells.map((cell) => [cell.getAttribute('colspan'), [...cell.children].map((child) => child.textContent)]), [
    ['9', ['n/a', 'Not available.', `${cutoff} ${unavailable}`]],
  ])
  assert.equal(cells[0]!.querySelector('[aria-hidden="true"]')!.textContent, 'n/a')
  assert.equal(cells[0]!.querySelector('.sr-only')!.textContent, 'Not available.')
  assert.equal(nvda!.querySelectorAll('td').length, 9, 'a row with values keeps a cell per column')
})

test('leads between two companies form one table of measures against pairs, each value keeping its whole label for hover and the inspector', () => {
  const block = structuredClone(financialAnswerFiscalCalendarsFixture) as FinancialAnswerBlock & { financial: FinancialAnswerContent }
  const labels = block.financial.labels as Record<string, { kind: string; text: string }>
  labels['measure:lead'] = { kind: 'measure', text: 'Difference in Gross margin (gross profit / revenue)' }
  labels['period:lead'] = { kind: 'period', text: 'NVIDIA Corp Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q2 FY2026 (ended 2026-06-27)' }
  const whole = 'Difference in Gross margin (gross profit / revenue), NVIDIA Corp Q4 FY2026 (ended 2026-01-25) minus Advanced Micro Devices, Inc. Q2 FY2026 (ended 2026-06-27)'
  const lead = {
    ...block.financial.results[0]!,
    result_id: '5e000000-0000-4000-8000-0000000000ff',
    subject_label_id: null,
    measure_label_id: 'measure:lead',
    period_label_id: 'period:lead',
    presented: { kind: 'value', text: '35.00 pp', full_text: '35 pp', value: '35', unit: { kind: 'percentage_points' }, exact: true },
  } as FinancialPresentedResult
  const operating = { ...lead, result_id: '5e000000-0000-4000-8000-0000000000fe', measure_label_id: 'measure:lead-operating', presented: { kind: 'gap', text: 'A required input or calculation is unavailable.', reason_code: 'missing_input' } } as FinancialPresentedResult
  labels['measure:lead-operating'] = { kind: 'measure', text: 'Difference in Operating margin (operating income / revenue)' }
  Object.assign(block.financial, {
    results: [...block.financial.results, lead, operating],
    presentations: [{ kind: 'scalar', result_id: lead.result_id }, { kind: 'scalar', result_id: operating.result_id }],
  })
  const inspector: EvidenceInspectorContextValue = { openInspection() {}, openBlockInspection() {}, openFinancialResult() {}, closeInspection() {} }
  const document = new JSDOM(renderToStaticMarkup(
    <EvidenceInspectorContext.Provider value={inspector}>
      <FinancialAnswer block={block} />
    </EvidenceInspectorContext.Provider>,
  )).window.document
  const tables = document.querySelectorAll('table')
  assert.equal(tables.length, 1, 'both leads share one table')
  assert.deepEqual([...tables[0]!.querySelectorAll('thead th')].map((heading) => [heading.textContent, heading.getAttribute('title')]), [
    ['Difference', null],
    ['NVIDIA − Advanced Micro Devices', 'NVIDIA Corp minus Advanced Micro Devices, Inc.'],
  ])
  assert.deepEqual([...tables[0]!.querySelectorAll('tbody tr')].map((row) => [...row.children].map((cell) => cell.textContent)), [
    ['Gross margin', '35.00 pp'],
    ['Operating margin', 'n/aA required input or calculation is unavailable.NVIDIA Corp Q4 FY2026 · ended Jan 2026 minus Advanced Micro Devices, Inc. Q2 FY2026 · ended Jun 2026'],
  ])
  const cell = document.querySelector(`[data-result-id="${lead.result_id}"]`)!
  assert.equal(cell.querySelector('span')!.getAttribute('title'), `${whole}: 35 pp`)
  assert.equal(cell.querySelector('button')!.getAttribute('aria-label'), `Inspect the verified calculation for ${whole}: 35 pp`)
  assert.deepEqual(resultShown(block.financial, lead), {
    subject: null,
    measure: 'Gross margin, NVIDIA Corp minus Advanced Micro Devices, Inc.',
    period: 'NVIDIA Corp Q4 FY2026 · ended Jan 2026 minus Advanced Micro Devices, Inc. Q2 FY2026 · ended Jun 2026',
    value: '35.00 pp',
  }, 'the inspector heads a lead with its two companies and short periods')
  assert.deepEqual(resultShown(block.financial, block.financial.results[0]!), { subject: 'NVIDIA Corp', measure: 'Revenue', period: 'Q4 FY2026', value: '$68.0B' })
})

function leadsDocument(leads: ReadonlyArray<{ measure: string; period: string; text: string }>): Document {
  const block = structuredClone(financialAnswerFiscalCalendarsFixture) as FinancialAnswerBlock & { financial: FinancialAnswerContent }
  const labels = block.financial.labels as Record<string, { kind: string; text: string }>
  const results = leads.map(({ measure, period, text }, index) => {
    labels[`measure:${measure}`] = { kind: 'measure', text: `Difference in ${measure}` }
    labels[`period:${period}`] = { kind: 'period', text: period }
    return {
      ...block.financial.results[0]!,
      result_id: `5e000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
      subject_label_id: null,
      measure_label_id: `measure:${measure}`,
      period_label_id: `period:${period}`,
      presented: { kind: 'value', text, full_text: text, value: '1', unit: { kind: 'percentage_points' }, exact: true },
    } as FinancialPresentedResult
  })
  Object.assign(block.financial, {
    results: [...block.financial.results, ...results],
    presentations: results.map((result) => ({ kind: 'scalar', result_id: result.result_id })),
  })
  return new JSDOM(renderToStaticMarkup(<FinancialAnswer block={block} />)).window.document
}

const tableText = (document: Document) => [...document.querySelectorAll('table tr')].map((row) => [...row.children].map((cell) => cell.textContent))

test('leads of one measure and pair for two periods each keep a row naming its periods', () => {
  const q1 = 'NVIDIA Corp Q1 FY2026 (ended 2025-04-27) minus Advanced Micro Devices, Inc. Q1 FY2026 (ended 2025-03-29)'
  const q2 = 'NVIDIA Corp Q2 FY2026 (ended 2025-07-27) minus Advanced Micro Devices, Inc. Q2 FY2026 (ended 2025-06-28)'
  const document = leadsDocument([
    { measure: 'Gross margin (gross profit / revenue)', period: q1, text: '10.00 pp' },
    { measure: 'Gross margin (gross profit / revenue)', period: q2, text: '11.00 pp' },
  ])
  assert.deepEqual(tableText(document), [
    ['Difference', 'Between', 'Value'],
    ['Gross margin', 'NVIDIA Corp Q1 FY2026 · ended Apr 2025 minus Advanced Micro Devices, Inc. Q1 FY2026 · ended Mar 2025', '10.00 pp'],
    ['Gross margin', 'NVIDIA Corp Q2 FY2026 · ended Jul 2025 minus Advanced Micro Devices, Inc. Q2 FY2026 · ended Jun 2025', '11.00 pp'],
  ])
})

test('leads of two measures that shorten alike each keep a row under the whole measure', () => {
  const period = 'NVIDIA Corp Q1 FY2026 (ended 2025-04-27) minus Advanced Micro Devices, Inc. Q1 FY2026 (ended 2025-03-29)'
  const document = leadsDocument([
    { measure: 'Gross margin (gross profit / revenue)', period, text: '10.00 pp' },
    { measure: 'Gross margin (gross profit / sales)', period, text: '12.00 pp' },
  ])
  assert.deepEqual(tableText(document), [
    ['Difference', 'NVIDIA − Advanced Micro Devices'],
    ['Gross margin (gross profit / revenue)', '10.00 pp'],
    ['Gross margin (gross profit / sales)', '12.00 pp'],
  ])
})

test('a row period of several quarters keeps every quarter, the first on its own line', () => {
  const block = structuredClone(financialAnswerFiscalCalendarsFixture) as FinancialAnswerBlock & { financial: FinancialAnswerContent }
  const table = block.financial.presentations[0] as FinancialTablePresentation
  Object.assign(table, { columns: table.columns.slice(0, 1), rows: table.rows.slice(0, 1).map((row) => ({ ...row, cells: row.cells.slice(0, 1) })) })
  const result = block.financial.results.find((candidate) => candidate.result_id === table.rows[0]!.cells[0])!
  ;(block.financial.labels as Record<string, { kind: string; text: string }>)[result.period_label_id] = {
    kind: 'period',
    text: 'Q4 FY2026 (ended 2026-01-25) vs Q3 FY2026 (ended 2025-10-26) vs Q2 FY2026 (ended 2025-07-27) vs Q1 FY2026 (ended 2025-04-27)',
  }
  const document = new JSDOM(renderToStaticMarkup(<FinancialAnswer block={block} />)).window.document
  const heading = document.querySelector('tbody th')!
  assert.deepEqual([...heading.childNodes].map((node) => node.textContent), [
    'NVIDIA',
    'Q4 FY2026 · ended Jan 2026 vs Q3 FY2026 · ended Oct 2025 vs Q2 FY2026 · ended Jul 2025 vs Q1 FY2026 · ended Apr 2025',
  ])
  assert.equal(heading.querySelector('span.block span.block')!.textContent, 'ended Jan 2026 vs Q3 FY2026 · ended Oct 2025 vs Q2 FY2026 · ended Jul 2025 vs Q1 FY2026 · ended Apr 2025')
})

test('a column heading drops the formula and abbreviates a quarter or year change, unless two headings would then read alike', () => {
  assert.deepEqual(columnNames([
    'Gross margin (gross profit / revenue)',
    'Quarter-over-quarter percent change in Revenue',
    'Year-over-year percent change in Gross margin (gross profit / revenue)',
    'Year-over-year change in Revenue',
    'Quarter-over-quarter percent change in EPS',
    'Percent change in Revenue over 2 quarters',
  ]), ['Gross margin', 'QoQ revenue', 'YoY gross margin', 'YoY revenue change', 'QoQ EPS', 'Percent change in Revenue over 2 quarters'])
  assert.deepEqual(columnNames(['Net margin (net income / revenue)', 'Net margin (net income / sales)']), ['Net margin (net income / revenue)', 'Net margin (net income / sales)'])
  assert.deepEqual(
    columnNames(['Net margin (net income / revenue)', 'Net margin (net income / sales)', 'Net margin (net income / revenue) (GAAP)']),
    ['Net margin (net income / revenue)', 'Net margin (net income / sales)', 'Net margin (net income / revenue) (GAAP)'],
    'a heading that reads as another column\'s kept heading is kept whole too',
  )
})

test('a company reads without its legal suffix, unless two companies would then read alike', () => {
  assert.deepEqual(shortNames(['Micron Technology Inc', 'NVIDIA Corp', 'Apple Inc.', 'Advanced Micro Devices, Inc.', 'JPMorgan Chase & Co.', 'Shell plc', 'Meta Platforms']), [
    'Micron Technology',
    'NVIDIA',
    'Apple',
    'Advanced Micro Devices',
    'JPMorgan Chase',
    'Shell',
    'Meta Platforms',
  ])
  assert.deepEqual(shortNames(['Acme Inc', 'Acme Corp']), ['Acme Inc', 'Acme Corp'])
  assert.deepEqual(shortNames(['Acme Inc', 'Acme Corp', 'Acme Inc Ltd']), ['Acme Inc', 'Acme Corp', 'Acme Inc Ltd'], 'a short name that reads as another company\'s kept name is kept whole too')
})

test('a table starts a new group where its figures turn from amounts to ratios to changes', () => {
  const answer = content(financialAnswerFiscalCalendarsFixture)
  assert.deepEqual(groupStarts(answer, answer.presentations[0] as FinancialTablePresentation, resultsById(answer)), [false, false, false, false, true, false, false, true, false])
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
  assert.deepEqual([eps.querySelector('[data-verification]')?.getAttribute('data-verification'), eps.querySelector('[data-inspect-result]')?.textContent], ['source_linked', 'USD 4.00 per share'])
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
