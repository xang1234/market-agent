import type { FindingSeverity } from '../blocks/types.ts'

// The fact-review queue grades candidates on a subset of the canonical
// severity scale (no `critical`). Deriving it from FindingSeverity keeps a
// single severity vocabulary across findings and review.
export type ReviewSeverity = Exclude<FindingSeverity, 'critical'>

// Fields any queue item exposes that severity depends on. Structural so the
// helpers below stay decoupled from the full FactReviewQueueItem shape (which
// lives in the queue component) — no circular import.
type SeverityInput = {
  confidence: number
  threshold: number
  age_seconds?: number
  stale_after_seconds?: number
}

export function isStaleItem(input: Pick<SeverityInput, 'age_seconds' | 'stale_after_seconds'>): boolean {
  return (
    input.age_seconds != null &&
    input.stale_after_seconds != null &&
    input.age_seconds >= input.stale_after_seconds
  )
}

// Severity for a queued candidate. A candidate far below the approval threshold
// is the riskiest to wave through, so severity tracks the shortfall
// (threshold − confidence). Stale candidates are always high — they have aged
// past their freshness window and hold up the queue regardless of confidence.
export function reviewSeverity(input: {
  confidence: number
  threshold: number
  isStale: boolean
}): ReviewSeverity {
  if (input.isStale) return 'high'
  const shortfall = input.threshold - input.confidence
  if (shortfall >= 0.15) return 'high'
  if (shortfall > 0) return 'medium'
  return 'low'
}

// Canonical "severity of an item" — the single derivation reused by both the
// queue rows and the queue-health rail, so the staleness + shortfall logic
// isn't re-implemented per surface.
export function severityForItem(item: SeverityInput): ReviewSeverity {
  return reviewSeverity({
    confidence: item.confidence,
    threshold: item.threshold,
    isStale: isStaleItem(item),
  })
}

export function tallySeverities(
  items: ReadonlyArray<SeverityInput>,
): Record<ReviewSeverity, number> {
  const counts: Record<ReviewSeverity, number> = { high: 0, medium: 0, low: 0 }
  for (const item of items) counts[severityForItem(item)] += 1
  return counts
}
