import type { ScreenerResultRow } from './contracts.ts'
import { finiteNumbers, median, numericDistribution, type Distribution } from '../symbol/distribution.ts'

export type ScreenerSummary = {
  shown: number
  // Share (0..100) of rows up today, of those carrying a finite change.
  upPct: number | null
  medianPe: number | null
  medianMarketCap: number | null
  // Currency of the median cap. null when cap-bearing rows span more than one
  // currency (native caps can't be pooled without FX) or none carry a cap.
  marketCapCurrency: string | null
  peDistribution: Distribution
}

// Summary over the *loaded* result rows (the current page) — the shape of
// what's on screen. The full match count is `total_count`, surfaced separately;
// aggregates over the entire match set beyond the page would need a backend
// summary, so everything here is scoped to and labelled "shown".
export function screenerSummary(rows: ReadonlyArray<ScreenerResultRow>): ScreenerSummary {
  const changes = finiteNumbers(rows.map((r) => r.quote.change_pct))
  const up = changes.filter((c) => c > 0).length
  // Native market caps can't be pooled across currencies without FX, so the
  // median cap is only meaningful (and its currency label correct) when every
  // cap-bearing row shares one currency; otherwise it's withheld.
  const capRows = rows.filter(
    (r) => typeof r.fundamentals.market_cap === 'number' && Number.isFinite(r.fundamentals.market_cap),
  )
  const currencies = new Set(capRows.map((r) => r.quote.currency))
  const marketCapCurrency = currencies.size === 1 ? [...currencies][0] : null
  return {
    shown: rows.length,
    upPct: changes.length === 0 ? null : (up / changes.length) * 100,
    medianPe: median(finiteNumbers(rows.map((r) => r.fundamentals.pe_ratio))),
    medianMarketCap:
      marketCapCurrency === null ? null : median(capRows.map((r) => r.fundamentals.market_cap as number)),
    marketCapCurrency,
    peDistribution: numericDistribution(rows.map((r) => r.fundamentals.pe_ratio)),
  }
}
