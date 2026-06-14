// Shared numeric-binning primitive behind every histogram in the app (the
// Screener metric distribution, the Review confidence histogram). Pure and
// tested here so the bin loop + guards aren't re-derived per feature.

export type DistributionBin = { from: number; to: number; count: number }

export type Distribution = {
  bins: ReadonlyArray<DistributionBin>
  // Tallest bin count — normalizes bar heights. 0 when there are no values.
  max: number
  min: number | null
  maxValue: number | null
  median: number | null
  // Finite values binned (null/undefined/NaN/Infinity dropped).
  count: number
}

const DEFAULT_BINS = 10

export function finiteNumbers(values: ReadonlyArray<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Bin finite numbers into `binCount` buckets. By default the buckets span the
// data's own [min, max]; pass `domain` to bin over a fixed range instead (e.g.
// [0, 1] for a probability), in which case out-of-range values clamp into the
// edge buckets. null/undefined/NaN/Infinity are dropped; a non-positive-integer
// binCount falls back to the default; a zero-width range puts every value in the
// first bucket. min/maxValue/median always reflect the raw finite values.
export function numericDistribution(
  values: ReadonlyArray<number | null | undefined>,
  options: { binCount?: number; domain?: readonly [number, number] } = {},
): Distribution {
  const requested = options.binCount
  const n =
    typeof requested === 'number' && Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_BINS
  const finite = finiteNumbers(values)
  const lo = options.domain ? options.domain[0] : finite.length > 0 ? Math.min(...finite) : 0
  const hi = options.domain ? options.domain[1] : finite.length > 0 ? Math.max(...finite) : 0
  const span = hi - lo
  const bins: DistributionBin[] = Array.from({ length: n }, (_, i) => ({
    from: lo + (span * i) / n,
    to: lo + (span * (i + 1)) / n,
    count: 0,
  }))
  for (const v of finite) {
    const raw = span === 0 ? 0 : Math.floor(((v - lo) / span) * n)
    bins[Math.max(0, Math.min(n - 1, raw))].count += 1
  }
  const max = bins.reduce((m, b) => Math.max(m, b.count), 0)
  return {
    bins,
    max,
    min: finite.length > 0 ? Math.min(...finite) : null,
    maxValue: finite.length > 0 ? Math.max(...finite) : null,
    median: median(finite),
    count: finite.length,
  }
}
