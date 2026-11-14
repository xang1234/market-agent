import assert from 'node:assert/strict'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'

import { EvidenceInspectorContext, type EvidenceInspectorContextValue } from '../evidence/evidenceInspectorContext.ts'

import { validateBlock } from './BlockValidator.ts'
import { BlockProofContext, type BlockProof } from './blockProof.ts'
import { FinancialAnswer } from './FinancialAnswer.tsx'
import { columnNames, resultsById, resultShown, seriesBars, shortNames, statementOf, tableCopyRows } from './financialAnswer.ts'
import { readFileSync } from 'node:fs'
import { financialAnswerFiscalCalendarsFixture, financialAnswerFixture, financialAnswerScenariosFixture } from './fixtures.ts'
import type { FinancialAnswerBlock, FinancialAnswerContent, FinancialPresentedResult, FinancialTablePresentation } from './types.ts'

function clone(): FinancialAnswerBlock & { financial: FinancialAnswerContent } {
  return JSON.parse(JSON.stringify(financialAnswerFixture))
}

function content(block: FinancialAnswerBlock): FinancialAnswerContent {
  return block.financial as FinancialAnswerContent
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

const quietContext: EvidenceInspectorContextValue = { openInspection() {}, openBlockInspection() {}, openFinancialResult() {}, closeInspection() {} }

function render(block: FinancialAnswerBlock, inspector = false): Document {
  const node = <FinancialAnswer block={block} />
  return new JSDOM(renderToStaticMarkup(inspector ? <EvidenceInspectorContext.Provider value={quietContext}>{node}</EvidenceInspectorContext.Provider> : node)).window.document
}

// What a sighted reader sees: text outside screen-reader-only spans.
function visible(node: Node): string {
  if (node.nodeType === node.TEXT_NODE) return node.textContent ?? ''
  if ((node as Element).classList?.contains('sr-only')) return ''
  return [...node.childNodes].map(visible).join('')
}

/** The statement as read on screen: the column headings' lines, then each row's cells, a section heading as a one-cell row. */
function statement(document: Document): { heads: string[][]; rows: string[][]; caption: string | null; footnotes: string[] } {
  const table = document.querySelector('[data-testid$="-table"] table')!
  return {
    heads: [...table.querySelectorAll('thead th')].map((heading) => [...heading.children].map(visible).filter(Boolean)),
    rows: [...table.querySelectorAll('tbody tr')].map((row) => [...row.children].map(visible)),
    caption: document.querySelector('[data-testid$="-period"]')?.textContent ?? null,
    footnotes: [...document.querySelectorAll('[data-testid$="-table"] ~ p')].map((note) => note.textContent!),
  }
}

type Editable = FinancialAnswerBlock & { financial: FinancialAnswerContent }

/** The fiscal-calendars answer as the engine dates it: NVIDIA's Q2 FY2027 beside Micron Technology's Q4 FY2026, optionally with the margin leads between them. */
function nvidiaMicron(leads: ReadonlyArray<string> = []): Editable {
  const block = structuredClone(financialAnswerFiscalCalendarsFixture) as Editable
  const labels = block.financial.labels as Record<string, { kind: string; text: string; slot_id?: string }>
  const periods: Record<string, string> = {
    'period:p0': 'Q2 FY2027 (ended 2026-07-26)',
    'period:p1': 'Q2 FY2027 (ended 2026-07-26) vs Q1 FY2027 (ended 2026-04-26)',
    'period:p2': 'Q2 FY2027 (ended 2026-07-26) vs Q2 FY2026 (ended 2025-07-27)',
    'period:p3': 'Q4 FY2026 (ended 2026-09-03)',
    'period:p4': 'Q4 FY2026 (ended 2026-09-03) vs Q3 FY2026 (ended 2026-05-29)',
    'period:p5': 'Q4 FY2026 (ended 2026-09-03) vs Q4 FY2025 (ended 2025-08-28)',
  }
  for (const [id, text] of Object.entries(periods)) labels[id] = { kind: 'period', text }
  labels['subject:b'] = { kind: 'subject', text: 'Micron Technology Inc', slot_id: 'b' }
  labels['period:lead'] = { kind: 'period', text: `NVIDIA Corp ${periods['period:p0']} minus Micron Technology Inc ${periods['period:p3']}` }
  const results = leads.map((measure, index) => {
    labels[`measure:lead${index}`] = { kind: 'measure', text: `Difference in ${measure}` }
    return {
      ...block.financial.results[0]!,
      result_id: `5e000000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`,
      subject_label_id: null,
      measure_label_id: `measure:lead${index}`,
      period_label_id: 'period:lead',
      presented: { kind: 'value', text: `-${index + 1}.00 pp`, full_text: `-${index + 1} pp`, value: `-${index + 1}`, unit: { kind: 'percentage_points' }, exact: true },
    } as FinancialPresentedResult
  })
  Object.assign(block.financial, {
    results: [...block.financial.results, ...results],
    presentations: [...block.financial.presentations, ...results.map((result) => ({ kind: 'scalar', result_id: result.result_id }))],
  })
  return block
}

const UNAVAILABLE = 'A required input or calculation is unavailable.'
const CUTOFF = 'No eligible input was public before the knowledge cutoff.'

test('a supported answer prints server strings with full values, coverage, and an accessible table', () => {
  const html = renderToStaticMarkup(<FinancialAnswer block={financialAnswerFixture} />)
  assert.match(html, /data-certified="true"/)
  assert.match(html, /data-coverage="partial"[^>]*>4 of 5 requested results verified</)
  assert.match(html, /<caption[^>]*>Revenue, Gross margin \(gross profit \/ revenue\) by company<\/caption>/)
  assert.match(html, /title="46\.206%" aria-label="46\.206%">46\.21%</, 'rounded label with the exact value for tooltips and assistive tech')
  assert.match(html, /Ranked 1 of 2 companies; no overall highest can be stated for an incomplete group/)
  assert.match(html, /at or above 40\.00%: yes/)
  assert.doesNotMatch(html, /figcaption/, 'no model-supplied title')
  const document = new JSDOM(html).window.document
  assert.deepEqual(statement(document), {
    heads: [[], ['Apple', 'FY2023'], ['Microsoft']],
    rows: [
      ['Amounts'],
      ['Revenue', '$391.0B', 'Not requested'],
      ['Margins'],
      ['Gross margin, FY2023', '46.21%', '—'],
    ],
    caption: null,
    footnotes: [`— ${UNAVAILABLE}`],
  })
  const apple = document.querySelector('thead th[data-subject="subject:a"] span')!
  assert.equal(apple.getAttribute('title'), 'Apple Inc.', 'the full company name on hover')
})

test('companies run across and measures down in sections, each column headed by its fiscal period and each cell by its value alone', () => {
  const document = render(nvidiaMicron(), true)
  assert.deepEqual(statement(document), {
    heads: [[], ['NVIDIA', 'Q2 FY2027'], ['Micron Technology', 'Q4 FY2026']],
    rows: [
      ['Amounts'],
      ['Revenue', '$68.0B', '$7.7B'],
      ['Gross profit', '$51.0B', '$3.1B'],
      ['Operating income', '$44.2B', '$770.0M'],
      ['Net income', '$37.4B', '$693.0M'],
      ['Margins'],
      ['Gross margin', '75.00%', '40.00%'],
      ['Operating margin', '65.00%', '10.00%'],
      ['Net margin', '55.00%', '9.00%'],
      ['Growth'],
      ['QoQ revenue', '19.30%', '4.80%'],
      ['YoY revenue', '73.20%', '—'],
    ],
    caption: null,
    footnotes: [
      'NVIDIA Q2 FY2027 ended Jul 2026; Micron Technology Q4 FY2026 ended Sep 2026. QoQ compares with the prior quarter, YoY with the same quarter a year earlier.',
      `— ${UNAVAILABLE}`,
    ],
  })
  const table = document.querySelector('table')!
  assert.doesNotMatch(table.textContent!, /ended|vs Q/, 'no end date or change base inside the table')
  assert.equal(document.querySelector('tbody td button')!.getAttribute('aria-label'), 'Inspect the verified calculation for USD 68000000000, Q2 FY2027 · ended Jul 2026', 'the whole period stays in the value\'s accessible label')
  const gap = document.querySelector('[data-result-id="98888888-8888-4888-9888-000000000018"] span')!
  assert.deepEqual([gap.getAttribute('title'), gap.querySelector('.sr-only')!.textContent], [UNAVAILABLE, UNAVAILABLE], 'a gap keeps its reason for hover and screen readers')
  assert.equal(document.querySelectorAll('thead button').length, 0, 'companies as columns are not sortable')
})

test('companies that read one fiscal period say it once above the table', () => {
  const block = nvidiaMicron()
  const labels = block.financial.labels as Record<string, { kind: string; text: string }>
  labels['period:p0'] = { kind: 'period', text: 'FY2026 (ended 2026-01-25)' }
  labels['period:p3'] = { kind: 'period', text: 'FY2026 (ended 2026-09-03)' }
  const table = block.financial.presentations[0] as FinancialTablePresentation
  Object.assign(table, { columns: table.columns.slice(0, 4), rows: table.rows.map((row) => ({ ...row, cells: row.cells.slice(0, 4) })) })
  const read = statement(render(block))
  assert.deepEqual([read.caption, read.heads, read.rows[0]], ['FY2026', [[], ['NVIDIA'], ['Micron Technology']], ['Revenue', '$68.0B', '$7.7B']], 'one kind of figure takes no section heading')
  assert.deepEqual(read.footnotes, ['NVIDIA FY2026 ended Jan 2026; Micron Technology FY2026 ended Sep 2026.'])
})

test('a cell of another period than its company names that fiscal period, and the footnote dates it', () => {
  const block = nvidiaMicron()
  const labels = block.financial.labels as Record<string, { kind: string; text: string }>
  labels['period:p9'] = { kind: 'period', text: 'Q3 FY2026 (ended 2026-05-29)' }
  const net = block.financial.results.find((result) => result.result_id.endsWith('000000000013'))!
  Object.assign(net, { disposition: 'missing', period_label_id: 'period:p9', presented: { kind: 'gap', text: CUTOFF, reason_code: 'missing_input' } })
  const read = statement(render(block))
  assert.deepEqual(read.rows.slice(1, 5).map((row) => row[2]), ['$7.7B', '$3.1B', '$770.0M', '—Q3 FY2026'])
  assert.deepEqual(read.footnotes, [
    'NVIDIA Q2 FY2027 ended Jul 2026; Micron Technology Q4 FY2026 ended Sep 2026, Q3 FY2026 ended May 2026. QoQ compares with the prior quarter, YoY with the same quarter a year earlier.',
    `— ${CUTOFF}`,
    `— ${UNAVAILABLE}`,
  ])
})

test('a column with its own period names it in the row label', () => {
  const block = nvidiaMicron()
  const labels = block.financial.labels as Record<string, { kind: string; text: string }>
  labels['period:fy25'] = { kind: 'period', text: 'FY2025' }
  const table = block.financial.presentations[0] as FinancialTablePresentation
  Object.assign(table, { columns: [table.columns[0], { ...table.columns[0]!, column_id: 'c9', period_label_id: 'period:fy25' }], rows: table.rows.map((row) => ({ ...row, cells: [row.cells[0], row.cells[0]] })) })
  assert.deepEqual(statement(render(block)).rows.map((row) => row[0]), ['Revenue', 'Revenue, FY2025'])
})

test('a company with no figure is a column of dashes with its reason said once below', () => {
  const block = nvidiaMicron()
  const micron = (block.financial.presentations[0] as FinancialTablePresentation).rows[1]!.cells
  for (const id of micron) Object.assign(block.financial.results.find((result) => result.result_id === id)!, { disposition: 'missing', presented: { kind: 'gap', text: CUTOFF, reason_code: 'missing_input' } })
  const read = statement(render(block))
  assert.deepEqual(read.rows.filter((row) => row.length > 1).map((row) => row[2]), Array(9).fill('—'))
  assert.deepEqual(read.footnotes.slice(1), [`— ${CUTOFF}`])
})

test('margin leads between the two companies fold into a Difference column beside their values', () => {
  const block = nvidiaMicron(['Gross margin (gross profit / revenue)', 'Operating margin (operating income / revenue)', 'Net margin (net income / revenue)'])
  const document = render(block, true)
  assert.equal(document.querySelectorAll('table').length, 1, 'no separate table of differences')
  const read = statement(document)
  assert.deepEqual(read.heads[3], ['Difference', 'NVIDIA − Micron Technology'])
  assert.deepEqual(read.rows.slice(5, 9), [
    ['Margins'],
    ['Gross margin', '75.00%', '40.00%', '-1.00 pp'],
    ['Operating margin', '65.00%', '10.00%', '-2.00 pp'],
    ['Net margin', '55.00%', '9.00%', '-3.00 pp'],
  ])
  assert.deepEqual(read.rows[1], ['Revenue', '$68.0B', '$7.7B', ''])
  const lead = block.financial.results.at(-3)!
  assert.equal(document.querySelector(`[data-result-id="${lead.result_id}"] button`)!.getAttribute('aria-label'), `Inspect the verified calculation for Difference in Gross margin (gross profit / revenue), ${labelOf(block, 'period:lead')}: -1 pp`)
})

test('a trailing sum, or a change between two, is named and dated by its newest quarter', () => {
  const quarters = (dates: ReadonlyArray<string>, year: number) => dates.map((date, back) => `Q${4 - (back % 4)} FY${year - Math.floor(back / 4)} (ended ${date})`).join(' vs ')
  const nvidia = ['2026-07-26', '2026-04-26', '2026-01-25', '2025-10-26', '2025-07-27', '2025-04-27', '2025-01-26', '2024-10-27']
  const micron = ['2026-09-03', '2026-05-29', '2026-02-26', '2025-11-27', '2025-08-28', '2025-05-29', '2025-02-27', '2024-11-28']
  for (const reads of [4, 8]) {
    const block = nvidiaMicron()
    const labels = block.financial.labels as Record<string, { kind: string; text: string }>
    labels['period:p0'] = { kind: 'period', text: quarters(nvidia.slice(0, reads), 2027) }
    labels['period:p3'] = { kind: 'period', text: quarters(micron.slice(0, reads), 2026) }
    const table = block.financial.presentations[0] as FinancialTablePresentation
    Object.assign(table, { columns: table.columns.slice(0, 4), rows: table.rows.map((row) => ({ ...row, cells: row.cells.slice(0, 4) })) })
    const read = statement(render(block))
    assert.deepEqual(read.heads, [[], ['NVIDIA', 'Q4 FY2027'], ['Micron Technology', 'Q4 FY2026']], `${reads} reads`)
    assert.deepEqual(read.footnotes, ['NVIDIA Q4 FY2027 ended Jul 2026; Micron Technology Q4 FY2026 ended Sep 2026.'], `${reads} reads`)
  }
})

test('a gap whose base is unbound leaves what the values compare with in the footnote', () => {
  const block = nvidiaMicron()
  const labels = block.financial.labels as Record<string, { kind: string; text: string }>
  labels['period:p5'] = { kind: 'period', text: 'Q4 FY2026 (ended 2026-09-03) vs fiscal quarter 4 before latest' }
  assert.equal(statement(render(block)).footnotes[0], 'NVIDIA Q2 FY2027 ended Jul 2026; Micron Technology Q4 FY2026 ended Sep 2026. QoQ compares with the prior quarter, YoY with the same quarter a year earlier.')
})

test('a copied table carries its Difference column as a row', () => {
  const block = nvidiaMicron(['Gross margin (gross profit / revenue)', 'Operating margin (operating income / revenue)', 'Net margin (net income / revenue)'])
  const content = block.financial
  const results = resultsById(content)
  const table = content.presentations[0] as FinancialTablePresentation
  const leads = content.results.slice(-3)
  const folded = statementOf(content, table, results, leads)
  const differences = new Map(folded.sections.flatMap((section) => section.rows.flatMap((row) => (row.difference ? [[row.key, row.difference] as const] : []))))
  const rows = tableCopyRows(content, table, results, differences)
  const last = rows.at(-1)!
  assert.equal(last[0], 'Difference (NVIDIA Corp minus Micron Technology Inc)')
  assert.deepEqual(['-1', '-2', '-3'].map((value) => last.includes(value)), [true, true, true])
  assert.equal(rows[0]!.filter((header) => /^Gross margin.* unit$/.test(header)).length, 1, 'a margin beside its difference in pp copies its unit per cell')
})

test('a lead that does not fit the table keeps the separate table of differences', () => {
  const block = nvidiaMicron(['Gross margin (gross profit / revenue)', 'Diluted EPS'])
  const document = render(block)
  assert.equal(statement(document).heads.length, 3, 'no Difference column')
  assert.deepEqual(tableText(document).slice(-3), [
    ['Difference', 'NVIDIA − Micron Technology'],
    ['Gross margin', '-1.00 pp'],
    ['Diluted EPS', '-2.00 pp'],
  ])
})

function labelOf(block: Editable, id: string): string {
  return block.financial.labels[id]!.text
}

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
    ['Operating margin', '—A required input or calculation is unavailable.NVIDIA Corp Q4 FY2026 · ended Jan 2026 minus Advanced Micro Devices, Inc. Q2 FY2026 · ended Jun 2026'],
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
