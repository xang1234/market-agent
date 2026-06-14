import type { ScreenerResultRow } from './contracts.ts'

export type DistributionBin = { from: number; to: number; count: number }

export type Distribution = {
  bins: ReadonlyArray<DistributionBin>
  // Tallest bin count — normalizes bar heights. 0 when there are no values.
  max: number
  min: number | null
  maxValue: number | null
  median: number | null
  // Number of finite values binned (nulls/NaN dropped).
  count: number
}

const DEFAULT_BINS = 10

function finiteNumbers(values: ReadonlyArray<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Bin finite numbers across their own [min, max] into `binCount` buckets;
// null/undefined/NaN/Infinity are dropped. A zero-width range (all values
// equal) puts everything in the first bin. A non-positive-integer binCount
// falls back to the default.
export function numericDistribution(
  values: ReadonlyArray<number | null | undefined>,
  binCount: number = DEFAULT_BINS,
): Distribution {
  const n = Number.isInteger(binCount) && binCount > 0 ? binCount : DEFAULT_BINS
  const finite = finiteNumbers(values)
  if (finite.length === 0) {
    return { bins: emptyBins(n), max: 0, min: null, maxValue: null, median: null, count: 0 }
  }
  const min = Math.min(...finite)
  const maxValue = Math.max(...finite)
  const span = maxValue - min
  const bins: DistributionBin[] = Array.from({ length: n }, (_, i) => ({
    from: min + (span * i) / n,
    to: min + (span * (i + 1)) / n,
    count: 0,
  }))
  for (const v of finite) {
    const idx = span === 0 ? 0 : Math.min(n - 1, Math.floor(((v - min) / span) * n))
    bins[idx].count += 1
  }
  const max = bins.reduce((m, b) => Math.max(m, b.count), 0)
  return { bins, max, min, maxValue, median: median(finite), count: finite.length }
}

function emptyBins(n: number): DistributionBin[] {
  return Array.from({ length: n }, () => ({ from: 0, to: 0, count: 0 }))
}

export type ScreenerSummary = {
  shown: number
  // Share (0..100) of rows up today, of those carrying a finite change.
  upPct: number | null
  medianPe: number | null
  medianMarketCap: number | null
  peDistribution: Distribution
}

// Summary over the *loaded* result rows (the current page) — the shape of
// what's on screen. The full match count is `total_count`, surfaced separately;
// aggregates over the entire match set beyond the page would need a backend
// summary, so everything here is scoped to and labelled "shown".
export function screenerSummary(rows: ReadonlyArray<ScreenerResultRow>): ScreenerSummary {
  const changes = finiteNumbers(rows.map((r) => r.quote.change_pct))
  const up = changes.filter((c) => c > 0).length
  return {
    shown: rows.length,
    upPct: changes.length === 0 ? null : (up / changes.length) * 100,
    medianPe: median(finiteNumbers(rows.map((r) => r.fundamentals.pe_ratio))),
    medianMarketCap: median(finiteNumbers(rows.map((r) => r.fundamentals.market_cap))),
    peDistribution: numericDistribution(rows.map((r) => r.fundamentals.pe_ratio)),
  }
}
