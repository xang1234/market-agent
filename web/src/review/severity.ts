import type { Severity } from '../blocks/SeverityBadge.tsx'

export type { Severity }

// Severity for a queued candidate fact. A candidate far below the auto-approval
// threshold is the riskiest to wave through, so severity tracks the shortfall
// (threshold − confidence). Stale candidates are always high — they have aged
// past their freshness window and hold up the queue regardless of confidence.
//
// Takes primitives rather than the full queue-item type so the queue component
// can depend on this helper without a circular import.
export function reviewSeverity(input: {
  confidence: number
  threshold: number
  isStale: boolean
}): Severity {
  if (input.isStale) return 'high'
  const shortfall = input.threshold - input.confidence
  if (shortfall >= 0.15) return 'high'
  if (shortfall > 0) return 'medium'
  return 'low'
}

export function isStaleItem(input: {
  age_seconds?: number
  stale_after_seconds?: number
}): boolean {
  return (
    input.age_seconds != null &&
    input.stale_after_seconds != null &&
    input.age_seconds >= input.stale_after_seconds
  )
}
