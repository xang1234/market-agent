import assert from 'node:assert/strict'
import test from 'node:test'

import type { InsiderTransaction, InstitutionalHolder } from './holders.ts'
import { insiderNetFlow, topOwnership } from './holdersCharts.ts'

function holder(name: string, pct: number, change = 0): InstitutionalHolder {
  return {
    holder_name: name,
    shares_held: pct * 1_000_000,
    market_value: 0,
    percent_of_shares_outstanding: pct,
    shares_change: change,
    filing_date: '2026-03-31',
  }
}

function txn(type: InsiderTransaction['transaction_type'], shares: number): InsiderTransaction {
  return {
    insider_name: 'X',
    insider_role: 'CEO',
    transaction_date: '2026-05-01',
    transaction_type: type,
    shares,
    price: null,
    value: null,
  }
}

test('topOwnership sorts by % desc, caps at topN, and sums the top share', () => {
  const result = topOwnership(
    [holder('State Street', 3.9), holder('Vanguard', 8.9, 1.2), holder('BlackRock', 7.6, -0.4), holder('FMR', 2.9)],
    3,
  )
  assert.deepEqual(result.bars.map((b) => b.holderName), ['Vanguard', 'BlackRock', 'State Street'])
  assert.equal(result.maxPct, 8.9)
  assert.ok(Math.abs(result.topSharePct - (8.9 + 7.6 + 3.9)) < 1e-9)
})

test('insiderNetFlow nets buys against sells and counts each side', () => {
  const flow = insiderNetFlow([
    txn('sell', 800_000),
    txn('buy', 200_000),
    txn('sell', 400_000),
    txn('option_exercise', 50_000), // ignored — not a market buy/sell
  ])
  assert.equal(flow.buyShares, 200_000)
  assert.equal(flow.sellShares, 1_200_000)
  assert.equal(flow.netShares, -1_000_000)
  assert.equal(flow.buyCount, 1)
  assert.equal(flow.sellCount, 2)
})

test('topOwnership distinguishes null-percent holders (SEC 13F) from no holders', () => {
  // Holders exist but none report a percentage → no bars, but NOT "no holders".
  const nullPct: InstitutionalHolder = {
    holder_name: 'Berkshire Hathaway Inc',
    shares_held: 915_560_382,
    market_value: 174_300_000_000,
    percent_of_shares_outstanding: null,
    shares_change: 12_000_000,
    filing_date: '2026-03-31',
  }
  const withNulls = topOwnership([nullPct], 5)
  assert.deepEqual(withNulls.bars, [])
  assert.equal(withNulls.percentUnavailable, true, 'holders present but no percent → unavailable, not empty')

  // Genuinely no holders → not "unavailable".
  assert.equal(topOwnership([], 5).percentUnavailable, false)

  // Holders with percentages → bars present, not unavailable.
  assert.equal(topOwnership([holder('Vanguard', 8.9)], 5).percentUnavailable, false)
})

test('empty inputs yield neutral results', () => {
  assert.deepEqual(topOwnership([], 5).bars, [])
  assert.equal(insiderNetFlow([]).netShares, 0)
})
