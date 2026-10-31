import assert from 'node:assert/strict'
import test from 'node:test'

import { provenanceRow, toCsv } from './csv.ts'
import { resultsById, seriesCsv, supportedFinancialContent, tableCsv } from './financialAnswer.ts'
import { financialAnswerFixture } from './fixtures.ts'

test('cells are quoted when they hold commas, quotes, line breaks, or edge spaces', () => {
  assert.equal(
    toCsv([['plain', 'a,b', 'say "hi"', 'two\nlines', ' padded']]),
    'plain,"a,b","say ""hi""","two\nlines"," padded"',
  )
  assert.equal(toCsv([['a'], ['b']]), 'a\r\nb')
})

test('a cell a spreadsheet would run as a formula is neutralised, but a negative number is not', () => {
  assert.equal(toCsv([['=SUM(A1)', '+1', '@cmd', '-cmd', '-0.05', '-12']]), "'=SUM(A1),'+1,'@cmd,'-cmd,-0.05,-12")
})

test('a certified table copies raw values with units in the headers and the source last', () => {
  const content = supportedFinancialContent(financialAnswerFixture)!
  const table = content.presentations.find((presentation) => presentation.kind === 'table')!
  assert.equal(table.kind, 'table')
  if (table.kind !== 'table') return
  assert.equal(
    toCsv([...tableCsv(content, table, resultsById(content)), provenanceRow(financialAnswerFixture)]),
    [
      'Company,Revenue (USD),Revenue period,"Gross margin (gross profit / revenue), FY2023 (ratio)"',
      'Apple Inc.,391035000000,FY2023,0.46206',
      'Microsoft Corp.,,,A required input or calculation is unavailable.',
      `As of ${financialAnswerFixture.as_of},Snapshot ${financialAnswerFixture.snapshot_id}`,
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
  assert.deepEqual(seriesCsv(content, series, resultsById(content)), [
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
  assert.deepEqual(tableCsv(content, table, results), [
    ['Company', 'Revenue, FY2023', 'Revenue, FY2023 unit'],
    ['Apple Inc.', '391035000000', 'USD'],
    ['Apple Inc.', '250000000000', 'EUR'],
  ])
})
