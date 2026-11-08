import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'

import { validateBlock } from './BlockValidator.ts'
import { BlockProofContext, proofLabels, UNPROVEN, type BlockProof } from './blockProof.ts'
import { ScenarioPriceComparison } from './ScenarioPriceComparison.tsx'
import type { ScenarioPriceComparisonBlock } from './types.ts'

// The server's own output (services/financial-core/test/scenario-price-comparison-contract.test.ts).
const [COMPARED, GAP] = JSON.parse(readFileSync(new URL('./scenarioPriceComparison.fixture.json', import.meta.url), 'utf8')) as ScenarioPriceComparisonBlock[]
const LINKED: BlockProof = { evidence: 'linked', calculation: 'not_verified', public_by_cutoff: 'unknown', scenario_calculation: 'verified' }

function render(block: ScenarioPriceComparisonBlock, proof: BlockProof | null): Document {
  const html = renderToStaticMarkup(
    <BlockProofContext.Provider value={proof}>
      <ScenarioPriceComparison block={block} />
    </BlockProofContext.Provider>,
  )
  return new JSDOM(html).window.document
}

const labels = (root: ParentNode) => [...root.querySelectorAll('[data-verification]')].map((node) => node.getAttribute('data-verification'))

test('the server-generated comparison and gap pass the canonical block schema; a title or extra field does not', () => {
  for (const block of [COMPARED!, GAP!]) {
    const result = validateBlock(block)
    assert.ok(result.valid, JSON.stringify(!result.valid && result.errors))
  }
  assert.equal(validateBlock({ ...COMPARED!, title: 'Upside' }).valid, false)
})

test('a linked comparison labels the price source-linked, the differences conditional, and names verified arithmetic only where it names the scenario answer', () => {
  const document = render(COMPARED!, LINKED)
  const price = document.querySelector('[data-testid$="-price"]')!
  assert.match(price.textContent ?? '', /Latest stored completed close: 2024-06-07/)
  assert.deepEqual(labels(price), ['source_linked'])
  for (const text of ['SCEN (USD)', '2024-06-07T20:00:00.000Z', '2024-06-07T20:15:00.000Z', 'session_close 5f000000-0000-4000-8000-0000000003d1', `sha256 ${'d'.repeat(64)}`, 'unadjusted', 'Same share basis']) {
    assert.ok(price.textContent?.includes(text), text)
  }
  const provenance = Object.fromEntries([...price.querySelectorAll('dt')].map((term) => [term.textContent, term.nextElementSibling?.textContent]))
  assert.equal(provenance['Source'], 'polygon_market', 'the source by its stored name')
  assert.equal(provenance['Source record'], `00000000-0000-4000-a000-000000000009 (sha256 ${'d'.repeat(64)})`)
  const rows = [...document.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.childNodes[0]?.textContent))
  assert.deepEqual(rows, [
    ['Bear', '20x', 'USD 80.00 per share', 'USD -20.00 per share', '-20.00%'],
    ['Base', '25x', 'USD 100.00 per share', 'USD 0.00 per share', '0.00%'],
    ['Bull', '30x', 'USD 120.00 per share', 'USD +20.00 per share', '+20.00%'],
  ])
  assert.deepEqual(labels(document.querySelector('thead')!), ['user_supplied', 'conditional_comparison'])
  const backLinks = [...document.querySelectorAll('[data-testid$="-certificate"]')]
  assert.equal(backLinks.length, 3)
  assert.equal(backLinks[0]!.textContent, 'EPS × P/E: Verified calculation in the scenario answer above')
  assert.equal(document.querySelectorAll('a').length, 0, 'plain text: the earlier answer may not be rendered to link to')
  const verified = [...document.querySelectorAll('[data-verification="verified"]')]
  assert.ok(verified.length === 3 && verified.every((label) => label.closest('[data-testid$="-certificate"]') !== null), 'no verified label outside the notes naming the scenario answer')
  assert.equal(document.querySelector('[role="note"]')?.textContent, 'Each scenario value set against one stored closing price as (scenario ÷ price) − 1. Conditional on the P/E you supplied; not a price target, forecast or recommendation.')
})

test('with no proof, or an unproven one, nothing is labelled linked or verified', () => {
  for (const proof of [null, UNPROVEN]) {
    const document = render(COMPARED!, proof)
    assert.deepEqual(labels(document.querySelector('[data-testid$="-price"]')!), ['not_verified'], JSON.stringify(proof))
    assert.equal(document.querySelectorAll('[data-verification="verified"], [data-verification="source_linked"]').length, 0)
  }
})

test('the note naming the scenario answer follows its certificate alone: shown while a source is no longer public, gone once the certificate is', () => {
  const sourceRevoked = render(COMPARED!, { ...LINKED, evidence: 'unknown' })
  assert.deepEqual(labels(sourceRevoked.querySelector('[data-testid$="-price"]')!), ['not_verified'])
  assert.equal(sourceRevoked.querySelectorAll('[data-testid$="-certificate"]').length, 3)
  const uncertified = render(COMPARED!, { ...LINKED, scenario_calculation: 'not_verified' })
  assert.deepEqual(labels(uncertified.querySelector('[data-testid$="-price"]')!), ['source_linked'])
  assert.equal(uncertified.querySelectorAll('[data-testid$="-certificate"], [data-verification="verified"]').length, 0)
})

test('the block labels itself: no outer proof label, so no badge spans the whole answer', () => {
  assert.deepEqual(proofLabels(LINKED, 'scenario_price_comparison'), [])
})

test('a named gap shows its reason and no values; an unknown version shows none', () => {
  const gap = render(GAP!, LINKED)
  assert.equal(gap.querySelector('[data-testid$="-gap"]')?.textContent, 'A stored closing price from by then has no proof it was public by the time asked for, so it is not used.')
  assert.equal(gap.querySelectorAll('tbody tr').length, 0)
  const future = render({ ...COMPARED!, comparison: { version: 'scenario-price-comparison.v2' } }, LINKED)
  assert.ok(future.querySelector('[data-testid$="-unsupported"]'))
  assert.equal(future.querySelectorAll('tbody tr').length, 0)
})
