import assert from 'node:assert/strict'
import test from 'node:test'

import { isIdentifier, readableDate, readableText, shortId, valueText } from './readable.ts'

test('dates read in words, a timestamp in the given time zone, anything else as given', () => {
  assert.equal(readableDate('2026-10-09'), 'Oct 9, 2026')
  assert.equal(readableDate('2026-11-14T01:50:04.131Z', 'UTC'), 'Nov 14, 2026, 01:50')
  assert.equal(readableDate('2024-01-10T23:59:59.999-05:00', 'UTC'), 'Jan 11, 2024, 04:59')
  assert.equal(readableDate('2026-11-14T01:50:04.131Z', 'Asia/Singapore'), 'Nov 14, 2026, 09:50')
  assert.equal(readableDate('Unknown'), 'Unknown')
})

test('identifiers shorten to scan: a UUID to its first eight characters, a long reference to its head and tail', () => {
  assert.equal(shortId('51bb2a4d-1660-4185-aadc-632015c5ed19'), '51bb2a4d…')
  assert.equal(shortId('sec_edgar:companyfacts:CIK0000723125#Revenues|USD|0000723125-26-000015|2026-02-27..2026-05-28'), 'sec_edgar:co…26-05-28')
  assert.equal(shortId('rich-text-1'), 'rich-text-1')
})

test('an identifier is one long token or a UUID, never a timestamp, a link, or prose', () => {
  assert.deepEqual(
    ['51bb2a4d-1660-4185-aadc-632015c5ed19', 'a'.repeat(64), '2026-11-12T23:46:38.946Z', 'https://www.sec.gov/Archives/edgar/data/723125/index.htm', 'Management cited demand.', 'revenue.v1'].map(isIdentifier),
    [true, true, false, false, false, false],
  )
})

test('server prose keeps its words with each UUID shortened and each timestamp in words', () => {
  assert.equal(
    readableText('Subjects: MU · XNAS — Micron Technology Inc (issuer:b6f1d101-ad99-4fce-96d7-ab694e32a0fb). Information public by 2026-11-14T01:50:04.131Z (UTC).', 'UTC'),
    'Subjects: MU · XNAS — Micron Technology Inc (issuer:b6f1d101…). Information public by Nov 14, 2026, 01:50.',
  )
})

test('a certified value reads as the answer prints it, and in full', () => {
  assert.deepEqual(valueText('54229000000', { kind: 'currency', currency: 'USD' }), { text: '$54.2B', full_text: 'USD 54229000000' })
  assert.deepEqual(valueText('0.86756', { kind: 'ratio' }), { text: '86.76%', full_text: '86.756%' })
  assert.deepEqual(valueText('25', { kind: 'ratio' }, 'pe_ratio'), { text: '25.00x', full_text: '25x' })
  assert.deepEqual(valueText('11.78', { kind: 'percentage_points' }), { text: '11.78 pp', full_text: '11.78 pp' })
  assert.equal(valueText('1e5', { kind: 'count' }), null, 'a value that is not a canonical decimal is not reformatted')
  assert.equal(valueText('5', { kind: 'furlongs' }), null, 'nor is a unit this client does not know')
})
