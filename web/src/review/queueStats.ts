// Pure summary stats for the fact-review queue's charts-first header. The queue
// component renders a thin presenter over these, so the binning/median logic is
// tested here rather than buried in JSX. Input is structural (only the fields
// the stats need) so this stays decoupled from the full FactReviewQueueItem —
// mirroring severity.ts and avoiding a circular import.
type ConfidenceInput = { confidence: number; threshold: number }

export type ConfidenceBin = { from: number; to: number; count: number }

export type ConfidenceDistribution = {
  bins: ReadonlyArray<ConfidenceBin>
  // Tallest bin, for normalizing bar heights. 0 when the queue is empty.
  max: number
  // Median approval threshold across the queue — the reference line candidates
  // are graded against. null when the queue is empty.
  thresholdMarker: number | null
  total: number
}

const DEFAULT_BINS = 10

// Bin the queue's confidence values across [0, 1] and locate the median
// approval threshold. Thresholds vary per candidate, so a single histogram axis
// can't draw each one — the median is the one reference line that means
// "candidates left of here are below the bar that graded them" for the typical
// item, which is what the reviewer reads at a glance.
export function confidenceDistribution(
  items: ReadonlyArray<ConfidenceInput>,
  binCount: number = DEFAULT_BINS,
): ConfidenceDistribution {
  const bins: ConfidenceBin[] = Array.from({ length: binCount }, (_, i) => ({
    from: i / binCount,
    to: (i + 1) / binCount,
    count: 0,
  }))
  for (const item of items) {
    const c = clamp01(item.confidence)
    // 1.0 lands in the last bin rather than spilling one past the array.
    const idx = Math.min(binCount - 1, Math.floor(c * binCount))
    bins[idx].count += 1
  }
  const max = bins.reduce((m, b) => Math.max(m, b.count), 0)
  return { bins, max, thresholdMarker: medianThreshold(items), total: items.length }
}

function medianThreshold(items: ReadonlyArray<ConfidenceInput>): number | null {
  if (items.length === 0) return null
  const sorted = items.map((i) => clamp01(i.threshold)).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
