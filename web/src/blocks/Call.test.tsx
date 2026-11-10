import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'

import { validateBlock } from './BlockValidator.ts'
import { BlockProofContext, proofLabels, UNPROVEN } from './blockProof.ts'
import { Call } from './Call.tsx'
import type { CallBlock } from './types.ts'

// The server's own output (services/financial-core/test/call-contract.test.ts).
const [RULE_ONE, RULE_ZERO] = JSON.parse(readFileSync(new URL('./call.fixture.json', import.meta.url), 'utf8')) as CallBlock[]
// The words ADVICE_WORDS forbids (services/financial-core/src/call.ts) and "hold", which ADR 0005 also forbids; "required return", the owner setting it names, is set aside.
const ADVICE = /\b(?:upside|downside|targets?|expected|returns?|undervalued|overvalued|fair|worth|buy|sell|hold|forecasts?|recommend\w*|cheap|expensive|potential)\b/iu

function render(block: CallBlock): Document {
  const html = renderToStaticMarkup(
    <BlockProofContext.Provider value={UNPROVEN}>
      <Call block={block} />
    </BlockProofContext.Provider>,
  )
  return new JSDOM(html).window.document
}

test('the server-generated Calls pass the canonical block schema; a title does not', () => {
  for (const block of [RULE_ONE!, RULE_ZERO!]) {
    const result = validateBlock(block)
    assert.ok(result.valid, JSON.stringify(!result.valid && result.errors))
  }
  assert.equal(validateBlock({ ...RULE_ONE!, title: 'Buy' }).valid, false)
})

test('a Call is headed "Agent opinion", dated, and carries no verified badge', () => {
  const document = render(RULE_ONE!)
  assert.equal(document.querySelector('figcaption')?.textContent, 'Agent opinion: AAPL, 2026-11-09')
  assert.deepEqual([...document.querySelectorAll('[data-verification]')], [])
  assert.deepEqual(proofLabels(UNPROVEN, 'call'), [], 'no outer proof label either')
})

test('rows read in ADR 0005 order, each with its kind and basis, and the decline cites the row it rests on', () => {
  const document = render(RULE_ONE!)
  assert.deepEqual([...document.querySelectorAll('h3')].map((heading) => heading.textContent), [
    'Facts used',
    'Assumptions',
    'What the price requires',
    'Declined (rule 1)',
  ])
  const rows = [...document.querySelectorAll('[data-row]')].map((row) => [
    row.getAttribute('data-row'),
    row.querySelector('[data-part="figure"]')?.textContent,
    row.querySelector('[data-part="kind"]')?.textContent,
    (row.querySelector('[data-part="basis"]')?.textContent ?? '').length > 0,
  ])
  assert.deepEqual(rows, [
    ['free_cash_flow', 'USD 136,056,000,000', 'Deterministic result', true],
    ['net_cash', 'USD 56,824,000,000', 'Deterministic result', true],
    ['stock_based_compensation', 'USD 13,789,000,000', 'Reported fact', true],
    ['shares_outstanding', '14,532,182,000 shares', 'Reported fact', true],
    ['share_price', 'USD 342.37 per share', 'Market observation', true],
    ['required_return', '10%', 'Owner policy', true],
    ['exit_multiple', '36.15x', 'Deterministic result', true],
    ['share_change', '0.277% a year', 'Agent assumption', true],
    ['required_growth', '7.3% a year', 'Deterministic result', true],
    ['consensus', '8.18%', 'Attributed consensus', true],
  ])
  assert.match(document.querySelector('[data-row="free_cash_flow"]')?.textContent ?? '', /10-K 0000320193-26-000026, period ended 2026-09-26, public by 2026-11-03/)
  assert.equal(document.querySelector('[data-reason]')?.textContent, 'Exit multiple (X): today\'s multiple: Today\'s multiple is the only exit multiple on file. Anchoring another needs about ten years of the company\'s own multiple history, which is not captured yet.')
  assert.match(document.body.textContent ?? '', /Your settings: required return 10%, margin of safety 1\.25, bear-loss limit 25%, near band 10%/)
})

test('a rule 0 Call names the outcome in the row and in row 3', () => {
  const document = render(RULE_ZERO!)
  assert.equal(document.querySelector('[data-row="free_cash_flow"] [data-part="figure"]')?.textContent, 'Not certified: blocked_dependency (blocked_by_dependency)')
  assert.equal(document.querySelector('[data-row="required_growth"] [data-part="figure"]')?.textContent, 'Not computed. Free cash flow: Not certified: blocked_dependency (blocked_by_dependency)')
  assert.equal(document.querySelector('[data-row="consensus"] [data-part="figure"]')?.textContent, 'no consensus within 7 days')
  assert.equal([...document.querySelectorAll('h3')].at(-1)?.textContent, 'Declined (rule 0)')
})

test('nothing a Call shows is advice wording', () => {
  for (const block of [RULE_ONE!, RULE_ZERO!]) {
    const text = (render(block).body.textContent ?? '').replaceAll(/required return/giu, '')
    assert.equal(ADVICE.exec(text)?.[0], undefined)
  }
})
