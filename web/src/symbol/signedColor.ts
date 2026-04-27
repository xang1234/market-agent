// Shared color palette + comparator for signed-magnitude UI surfaces (insider
// transaction direction, holder share-change deltas, sentiment scores, etc.).
// Centralized so palette tweaks land in one place and the deadband threshold
// is explicit per surface.

export const NEUTRAL_CLASS = 'text-neutral-500 dark:text-neutral-400'
export const POSITIVE_CLASS = 'text-emerald-700 dark:text-emerald-400'
export const NEGATIVE_CLASS = 'text-red-700 dark:text-red-400'

export type SignedDirection = 'positive' | 'negative' | 'neutral'

export function signedDirection(value: number, deadband = 0): SignedDirection {
  if (value > deadband) return 'positive'
  if (value < -deadband) return 'negative'
  return 'neutral'
}

const SIGNED_TEXT_CLASS: Readonly<Record<SignedDirection, string>> = {
  positive: POSITIVE_CLASS,
  negative: NEGATIVE_CLASS,
  neutral: NEUTRAL_CLASS,
}

export function signedTextClass(value: number, deadband = 0): string {
  return SIGNED_TEXT_CLASS[signedDirection(value, deadband)]
}
