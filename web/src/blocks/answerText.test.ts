import assert from 'node:assert/strict'
import test from 'node:test'

import { answerCopy, answerText } from './answerText.ts'
import { disclosureFixture, financialAnswerFixture, lineChartFixture, richTextFixture, tableFixture } from './fixtures.ts'
import type { FinancialAnswerBlock } from './types.ts'

test('an answer copies as Markdown, and a chart names itself instead of vanishing', () => {
  assert.equal(
    answerText([richTextFixture, tableFixture, lineChartFixture, disclosureFixture]),
    [
      'Apple posted Q3 revenue of $85.8B, up year over year. Management guided cautiously on services growth.',
      'Recent quarters\n\n| Quarter | Revenue | Net income |\n| --- | --- | --- |\n| Q3 FY24 | $85.8B | $21.4B |\n| Q2 FY24 | $90.8B | $23.6B |\n| Q1 FY24 | $119.6B | $33.9B |',
      '[In the app: Revenue trajectory]',
      '- Forward estimates are model-derived and may diverge from consensus.\n- Quotes are delayed by 15 minutes during regular trading hours.',
    ].join('\n\n'),
  )
})

test('a certified answer copies the figures as it shows them, with each cell\'s own period', () => {
  assert.equal(
    answerText([financialAnswerFixture]),
    [
      'Revenue, Gross margin (gross profit / revenue) by company',
      '| Company | Revenue | Gross margin (gross profit / revenue), FY2023 |\n| --- | --- | --- |\n| Apple Inc. | USD 391,035,000,000.00 (FY2023) | 46.21% |\n| Microsoft Corp. |  | A required input or calculation is unavailable. |',
      'Apple Inc. — Gross margin (gross profit / revenue), FY2023, at or above 40.00%: yes',
      'Ranked 1 of 2 companies; no overall highest can be stated for an incomplete group',
    ].join('\n\n'),
  )
})

test('an answer in a format this app does not know copies nothing for that block', () => {
  const newer = { ...financialAnswerFixture, financial: { presentation_version: 'financial-presentation.v99' } } as FinancialAnswerBlock
  assert.equal(answerText([newer, richTextFixture]), 'Apple posted Q3 revenue of $85.8B, up year over year. Management guided cautiously on services growth.')
})

test('a pipe in a cell cannot split a Markdown table column', () => {
  const table = { ...tableFixture, title: undefined, columns: ['A|B'], rows: [['x|y']] }
  assert.equal(answerText([table]), '| A\\|B |\n| --- |\n| x\\|y |')
})

test('text the app shows literally stays literal, while the answer\'s own Markdown passes through', () => {
  const block = {
    ...richTextFixture,
    segments: [
      { type: 'text' as const, text: '**Margins** held, with ' },
      { type: 'ref' as const, ref_kind: 'fact' as const, ref_id: 'f1', format: '*Adjusted EPS* [est]' },
      { type: 'text' as const, text: ' and a toned ', tone: undefined },
      { type: 'text' as const, text: '_+3%_', tone: 'positive' as const },
    ],
  }
  assert.equal(answerText([block]), '**Margins** held, with \\*Adjusted EPS\\* \\[est\\] and a toned \\_+3%\\_')
})

test('a table cell keeps its backslashes and pipes inside its column', () => {
  const table = { ...tableFixture, title: undefined, columns: ['Note'], rows: [['a\\|b *c*']] }
  assert.equal(answerText([table]), '| Note |\n| --- |\n| a\\\\\\|b \\*c\\* |')
})

test('a copied answer ends with the date of its newest data and its snapshot', () => {
  const older = { ...richTextFixture, as_of: '2026-05-01T00:00:00.000Z' }
  const newer = { ...disclosureFixture, as_of: '2026-06-01T00:00:00.000Z' }
  assert.equal(
    answerCopy({ blocks: [older, newer], snapshot_id: 'snap-1' }).split('\n\n').at(-1),
    'As of 2026-06-01T00:00:00.000Z · Snapshot snap-1',
  )
})
