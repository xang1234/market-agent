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
const [STATED, RULE_ZERO, UNANCHORED] = JSON.parse(readFileSync(new URL('./call.fixture.json', import.meta.url), 'utf8')) as CallBlock[]
// main's fixture at de724754: Calls saved before the exit multiple was anchored (#605).
const [SAVED_V1] = JSON.parse(readFileSync(new URL('./call.v1.fixture.json', import.meta.url), 'utf8')) as CallBlock[]
// main's fixture at 72a64ec6: Calls saved before the base rate.
const [SAVED_V2] = JSON.parse(readFileSync(new URL('./call.v2.fixture.json', import.meta.url), 'utf8')) as CallBlock[]
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
  for (const block of [STATED!, RULE_ZERO!, UNANCHORED!]) {
    const result = validateBlock(block)
    assert.ok(result.valid, JSON.stringify(!result.valid && result.errors))
  }
  assert.equal(validateBlock({ ...STATED!, title: 'Buy' }).valid, false)
})

test('a Call is headed "Agent opinion", dated, and carries no verified badge', () => {
  const document = render(STATED!)
  assert.equal(document.querySelector('figcaption')?.textContent, 'Agent opinion: AAPL, 2026-11-09')
  assert.deepEqual([...document.querySelectorAll('[data-verification]')], [])
  assert.deepEqual(proofLabels(UNPROVEN, 'call'), [], 'no outer proof label either')
})

test('rows read in ADR 0005 order, each with its kind and basis, and the stance cites the rows it rests on and names what it does not show', () => {
  const document = render(STATED!)
  assert.deepEqual([...document.querySelectorAll('h3')].map((heading) => heading.textContent), [
    'Facts used',
    'Assumptions',
    'What the price requires',
    'Stance (rule 6)',
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
    ['revenue', 'USD 478,834,000,000', 'Reported fact', true],
    ['required_return', '10%', 'Owner policy', true],
    ['exit_multiple', '36.15x', 'Deterministic result', true],
    ['anchored_exit_multiple', '17.33x', 'Agent assumption', true],
    ['share_change', '0.277% a year', 'Agent assumption', true],
    ['base_case', 'Growth 4.24% a year at 17.33x: base value USD 165.86 per share', 'Agent assumption', true],
    ['bear_case', 'Growth -4.93% a year at 17.33x: bear value USD 111.73 per share', 'Agent assumption', true],
    ['required_growth', '7.3% a year', 'Deterministic result', true],
    ['required_growth_anchored', '22.5% a year', 'Deterministic result', true],
    ['base_rate', 'Of 430 five-year windows that began at a similar size (starting revenue USD 50.0B and up), 168 (39.1%) delivered free cash flow growth of at least 7.33% a year. Beside it, revenue grew at least that fast in 180 of 650 (27.7%).', 'Deterministic result', true],
    ['consensus', '8.18%', 'Attributed consensus', true],
  ])
  assert.match(document.querySelector('[data-row="anchored_exit_multiple"]')?.textContent ?? '', /FY2017: 17\.48x, \(close 38\.53 on 2017-09-29 × 21,006,768,000 shares/)
  assert.match(document.querySelector('[data-row="free_cash_flow"]')?.textContent ?? '', /10-K 0000320193-26-000026, period ended 2026-09-26, public by 2026-11-03/)
  assert.equal(document.querySelector('[data-part="stance"]')?.textContent, 'Falls short of your hurdle.')
  assert.equal(document.querySelector('[data-reason]')?.textContent, 'Base case: The base value V is USD 165.86 per share. The value test holds up to V ÷ your margin of safety 1.25 = USD 132.68.')
  assert.deepEqual([...document.querySelectorAll('[data-reason]')].map((reason) => reason.getAttribute('data-reason')), [
    'base_case', 'bear_case', 'share_price', 'base_case', 'share_change', 'required_return', 'anchored_exit_multiple',
  ])
  assert.deepEqual([...document.querySelectorAll('[data-not-shown]')].map((entry) => entry.getAttribute('data-not-shown')), ['skew', 'falsifiers'])
  assert.match(document.body.textContent ?? '', /Your settings: required return 10%, margin of safety 1\.25, bear-loss limit 25%, near band 10%/)
})

test('a rule 0 Call names the outcome in the row and in row 3', () => {
  const document = render(RULE_ZERO!)
  assert.equal(document.querySelector('[data-row="free_cash_flow"] [data-part="figure"]')?.textContent, 'Not certified: blocked_dependency (blocked_by_dependency)')
  assert.equal(document.querySelector('[data-row="required_growth"] [data-part="figure"]')?.textContent, 'Not computed. Free cash flow: Not certified: blocked_dependency (blocked_by_dependency)')
  assert.equal(document.querySelector('[data-row="consensus"] [data-part="figure"]')?.textContent, 'no consensus within 7 days')
  assert.equal([...document.querySelectorAll('h3')].at(-1)?.textContent, 'Declined (rule 0)')
})

test('an unanchored exit multiple says why, and the decline names both missing anchors', () => {
  const document = render(UNANCHORED!)
  assert.equal(document.querySelector('[data-row="anchored_exit_multiple"] [data-part="figure"]')?.textContent, "Not anchored: no closes are captured for the listing by the Call's cutoff.")
  assert.deepEqual([...document.querySelectorAll('[data-reason]')].map((reason) => reason.getAttribute('data-reason')), ['anchored_exit_multiple', 'bear_case'])
  assert.deepEqual([...document.querySelectorAll('[data-not-shown]')], [], 'a declined Call names no unshown part')
})

test('nothing a Call shows is advice wording', () => {
  for (const block of [STATED!, RULE_ZERO!, UNANCHORED!]) {
    const text = (render(block).body.textContent ?? '').replaceAll(/required return/giu, '')
    assert.equal(ADVICE.exec(text)?.[0], undefined)
  }
})

test('a Call saved before #605 still passes the schema and shows its own rows and decline', () => {
  const result = validateBlock(SAVED_V1!)
  assert.ok(result.valid, JSON.stringify(!result.valid && result.errors))
  const document = render(SAVED_V1!)
  assert.deepEqual([...document.querySelectorAll('[data-row]')].map((row) => row.getAttribute('data-row')), [
    'free_cash_flow', 'net_cash', 'stock_based_compensation', 'shares_outstanding', 'share_price', 'required_return', 'exit_multiple', 'share_change', 'required_growth', 'consensus',
  ])
  assert.equal(document.querySelector('[data-row="exit_multiple"] dt')?.textContent, "Exit multiple (X): today's multiple")
  assert.equal(document.querySelector('[data-reason]')?.getAttribute('data-reason'), 'exit_multiple')
})

test('a Call saved before its base rate still passes the schema and shows its own rows', () => {
  const result = validateBlock(SAVED_V2!)
  assert.ok(result.valid, JSON.stringify(!result.valid && result.errors))
  const rows = [...render(SAVED_V2!).querySelectorAll('[data-row]')].map((row) => row.getAttribute('data-row'))
  assert.equal(rows.includes('revenue') || rows.includes('base_rate'), false)
  assert.equal(rows.length, 13)
})
