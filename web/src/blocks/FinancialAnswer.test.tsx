import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { validateBlock } from './BlockValidator.ts'
import { FinancialAnswer } from './FinancialAnswer.tsx'
import { resultsById, seriesBarHeights, sortedRowIndexes } from './financialAnswer.ts'
import { financialAnswerFixture } from './fixtures.ts'
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
  assert.match(html, /<th scope="row"[^>]*>Apple Inc\.<\/th>/)
  assert.match(html, /title="46\.206%" aria-label="46\.206%">46\.21%</, 'rounded label with the exact value for tooltips and assistive tech')
  assert.match(html, /A required input or calculation is unavailable\./, 'a gap is shown as a gap')
  assert.match(html, /Not requested/, 'a cell outside the request is explicit')
  assert.match(html, /Ranked 1 of 2 companies; no overall highest can be stated for an incomplete group/)
  assert.match(html, /at or above 40\.00%: yes/)
  assert.doesNotMatch(html, /figcaption/, 'no model-supplied title')
})

test('sorting uses the server exact order; descending keeps rows without a value last', () => {
  const block = clone()
  const presentation: FinancialTablePresentation = {
    ...table(block),
    rows: [
      { label_id: 'subject:a', cells: [null, '92222222-2222-4222-9222-222222222222'] },
      { label_id: 'subject:b', cells: [null, '93333333-3333-4333-9333-333333333333'] },
      { label_id: 'subject:c', cells: [null, '96666666-6666-4666-9666-666666666666'] },
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

test('series bar geometry is bounded and ignores gaps and non-finite values', () => {
  const value = (text: string): FinancialPresentedResult => ({
    result_id: 'x', output_id: 'o', disposition: 'verified', label_ids: [], result_hash: '',
    presented: { kind: 'value', text, full_text: text, value: text, unit: { kind: 'count' }, exact: true },
  })
  const gap = content(financialAnswerFixture).results[2]!
  assert.deepEqual(seriesBarHeights([value('50'), value('-100'), gap, undefined, value('1e999')]), [0.5, 1, null, null, null])
  assert.deepEqual(seriesBarHeights([value('0'), value('0')]), [0, 0])
})
