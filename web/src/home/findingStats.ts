import type { FindingSeverity } from '../blocks/types.ts'
import type { HomeFindingCardSummary } from './summaryClient.ts'

// Highest severity first — drives both the stacked-bar segment order and the
// legend on Home's findings feed.
export const FINDING_SEVERITY_ORDER: ReadonlyArray<FindingSeverity> = ['critical', 'high', 'medium', 'low']

export function tallyFindingSeverities(
  cards: ReadonlyArray<HomeFindingCardSummary>,
): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const card of cards) counts[card.severity] += 1
  return counts
}
