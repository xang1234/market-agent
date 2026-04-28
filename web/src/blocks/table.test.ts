import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTableCell } from './table.ts'

test('formatTableCell prints strings verbatim', () => {
  assert.equal(formatTableCell('Q3 FY24'), 'Q3 FY24')
  assert.equal(formatTableCell(''), '')
})

test('formatTableCell prints finite numbers as their string form', () => {
  assert.equal(formatTableCell(42), '42')
  assert.equal(formatTableCell(-1.5), '-1.5')
  assert.equal(formatTableCell(0), '0')
})

test('formatTableCell renders non-finite numbers as em-dash', () => {
  assert.equal(formatTableCell(Number.NaN), '—')
  assert.equal(formatTableCell(Number.POSITIVE_INFINITY), '—')
  assert.equal(formatTableCell(Number.NEGATIVE_INFINITY), '—')
})

test('formatTableCell JSON-stringifies object cells so misshapen rows stay debuggable', () => {
  assert.equal(formatTableCell({ note: 'pending', amount: 12 }), '{"note":"pending","amount":12}')
})
