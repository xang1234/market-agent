import assert from 'node:assert/strict'
import test from 'node:test'

import { provenanceRow, toTsv } from './tableCopy.ts'
import { resultsById, seriesCopyRows, supportedFinancialContent, tableCopyRows } from './financialAnswer.ts'
import { financialAnswerFixture } from './fixtures.ts'

test('cells are tab-separated, quoted only when they hold a tab, quote, or line break', () => {
  assert.equal(
    toTsv([['plain', 'a,b', 'say "hi"', 'two\nlines', 'tab\there']]),
    'plain\ta,b\t"say ""hi"""\t"two\nlines"\t"tab\there"',
  )
  assert.equal(toTsv([['a'], ['b']]), 'a\r\nb')
})

test('only a plain number may start with a minus; anything a spreadsheet would run is neutralised', () => {
  assert.equal(
    toTsv([['=SUM(A1)', '+1', '@cmd', '-cmd', '-1+HYPERLINK("x")', '-0.05', '-12', '391035000000']]),
    "'=SUM(A1)\t'+1\t'@cmd\t'-cmd\t\"'-1+HYPERLINK(\"\"x\"\")\"\t-0.05\t-12\t391035000000",
  )
})

test('a certified table copies raw values with units in the headers and the source last', () => {
  const content = supportedFinancialContent(financialAnswerFixture)!
  const table = content.presentations.find((presentation) => presentation.kind === 'table')!
  assert.equal(table.kind, 'table')
  if (table.kind !== 'table') return
  assert.equal(
    toTsv([...tableCopyRows(content, table, resultsById(content)), provenanceRow(financialAnswerFixture)]),
    [
      'Company\tRevenue (USD)\tRevenue period\tGross margin (gross profit / revenue), FY2023 (ratio)',
      'Apple Inc.\t391035000000\tFY2023\t0.46206',
      'Microsoft Corp.\t\t\tA required input or calculation is unavailable.',
      `As of ${financialAnswerFixture.as_of}\tSnapshot ${financialAnswerFixture.snapshot_id}`,
    ].join('\r\n'),
  )
})

test('a certified series copies one period and raw value per row', () => {
  const content = supportedFinancialContent(financialAnswerFixture)!
  const revenue = content.results.find((result) => result.presented.kind === 'value' && result.presented.value === '391035000000')!
  const series = {
    kind: 'series' as const,
    subject_label_id: revenue.subject_label_id!,
    measure_label_id: revenue.measure_label_id,
    points: [{ period_label_id: revenue.period_label_id, result_id: revenue.result_id }],
  }
  assert.deepEqual(seriesCopyRows(content, series, resultsById(content)), [
    ['Period', 'Apple Inc.: Revenue (USD)'],
    ['FY2023', '391035000000'],
  ])
})

test('a column mixing currencies names each row\'s unit instead of one header unit', () => {
  const content = supportedFinancialContent(financialAnswerFixture)!
  const usd = content.results.find((result) => result.presented.kind === 'value' && result.presented.value === '391035000000')!
  if (usd.presented.kind !== 'value') return
  const eur = { ...usd, result_id: 'eur-revenue', presented: { ...usd.presented, value: '250000000000', unit: { kind: 'currency' as const, currency: 'EUR' } } }
  const results = new Map(resultsById(content)).set(eur.result_id, eur)
  const table = {
    kind: 'table' as const,
    caption: '',
    columns: [{ column_id: 'c1', measure_label_id: usd.measure_label_id, period_label_id: usd.period_label_id }],
    rows: [
      { subject_label_id: usd.subject_label_id!, cells: [usd.result_id] },
      { subject_label_id: usd.subject_label_id!, cells: [eur.result_id] },
    ],
    ascending: {},
  }
  assert.deepEqual(tableCopyRows(content, table, results), [
    ['Company', 'Revenue, FY2023', 'Revenue, FY2023 unit'],
    ['Apple Inc.', '391035000000', 'USD'],
    ['Apple Inc.', '250000000000', 'EUR'],
  ])
})

test('a sorted table copies in the order it is shown', () => {
  const content = supportedFinancialContent(financialAnswerFixture)!
  const table = content.presentations.find((presentation) => presentation.kind === 'table')!
  if (table.kind !== 'table') return
  assert.deepEqual(tableCopyRows(content, table, resultsById(content), [1, 0]).map((row) => row[0]), ['Company', 'Microsoft Corp.', 'Apple Inc.'])
})
