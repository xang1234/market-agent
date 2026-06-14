// Pure shaping for the Holders charts: top institutional owners by % of shares
// (for the ownership bars) and the insider buy/sell net flow over the window.

import type { InsiderTransaction, InstitutionalHolder } from './holders.ts'

export type OwnershipBar = {
  key: string
  holderName: string
  pct: number
  sharesChange: number
}

export type OwnershipView = {
  bars: ReadonlyArray<OwnershipBar>
  maxPct: number
  topSharePct: number
}

export function topOwnership(
  holders: ReadonlyArray<InstitutionalHolder>,
  topN: number,
): OwnershipView {
  const sorted = [...holders]
    .sort((a, b) => b.percent_of_shares_outstanding - a.percent_of_shares_outstanding)
    .slice(0, topN)
  const bars = sorted.map((h, i) => ({
    key: `${h.holder_name}-${i}`,
    holderName: h.holder_name,
    pct: h.percent_of_shares_outstanding,
    sharesChange: h.shares_change,
  }))
  return {
    bars,
    maxPct: bars.length === 0 ? 0 : bars[0].pct,
    topSharePct: bars.reduce((sum, b) => sum + b.pct, 0),
  }
}

export type InsiderNetFlow = {
  netShares: number
  buyShares: number
  sellShares: number
  buyCount: number
  sellCount: number
}

export function insiderNetFlow(transactions: ReadonlyArray<InsiderTransaction>): InsiderNetFlow {
  let buyShares = 0
  let sellShares = 0
  let buyCount = 0
  let sellCount = 0
  for (const txn of transactions) {
    if (txn.transaction_type === 'buy') {
      buyShares += txn.shares
      buyCount += 1
    } else if (txn.transaction_type === 'sell') {
      sellShares += txn.shares
      sellCount += 1
    }
    // option_exercise / gift / other aren't open-market flow — excluded.
  }
  return { netShares: buyShares - sellShares, buyShares, sellShares, buyCount, sellCount }
}
