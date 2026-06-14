import { median, numericDistribution, type Distribution } from '../symbol/distribution.ts'

// Structural input — only the fields the confidence summary needs, decoupled
// from the full FactReviewQueueItem (mirrors severity.ts, avoids a circular
// import).
type ConfidenceInput = { confidence: number; threshold: number }

export type ConfidenceDistribution = Distribution & {
  // Median approval threshold across the queue — the reference line candidates
  // are graded against. null when the queue is empty. Thresholds vary per item,
  // so a single axis can't draw each; the median is the one meaningful marker.
  thresholdMarker: number | null
}

// Bin the queue's confidence values over the fixed [0, 1] probability domain and
// locate the median approval threshold. A thin wrapper over the shared
// numericDistribution.
export function confidenceDistribution(
  items: ReadonlyArray<ConfidenceInput>,
  binCount?: number,
): ConfidenceDistribution {
  const distribution = numericDistribution(
    items.map((item) => item.confidence),
    { binCount, domain: [0, 1] },
  )
  return { ...distribution, thresholdMarker: median(items.map((item) => clamp01(item.threshold))) }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
