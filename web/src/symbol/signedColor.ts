// Shared color palette + comparator for signed-magnitude UI surfaces (insider
// transaction direction, holder share-change deltas, sentiment scores, etc.).
// Centralized so palette tweaks land in one place and the deadband threshold
// is explicit per surface.

export const NEUTRAL_CLASS = 'text-muted'
export const POSITIVE_CLASS = 'text-positive'
export const NEGATIVE_CLASS = 'text-negative'

// Filled-pill variants (redesign tokens). Soft tinted background + signed text,
// for the green/red %-change pills that scan faster than plain colored text.
// Token-based so they flip with the theme via the .dark CSS-variable overrides.
export const NEUTRAL_PILL_CLASS = 'bg-surface-2 text-muted'
export const POSITIVE_PILL_CLASS = 'bg-positive-soft text-positive'
export const NEGATIVE_PILL_CLASS = 'bg-negative-soft text-negative'

export type SignedDirection = 'positive' | 'negative' | 'neutral'

export function signedDirection(value: number, deadband = 0): SignedDirection {
  if (value > deadband) return 'positive'
  if (value < -deadband) return 'negative'
  return 'neutral'
}

export const SIGNED_TEXT_CLASS: Readonly<Record<SignedDirection, string>> = {
  positive: POSITIVE_CLASS,
  negative: NEGATIVE_CLASS,
  neutral: NEUTRAL_CLASS,
}

export const SIGNED_PILL_CLASS: Readonly<Record<SignedDirection, string>> = {
  positive: POSITIVE_PILL_CLASS,
  negative: NEGATIVE_PILL_CLASS,
  neutral: NEUTRAL_PILL_CLASS,
}

// Arrow glyph kept alongside color so meaning is not encoded by color alone
// (accessibility). Neutral renders no arrow.
export const SIGNED_ARROW: Readonly<Record<SignedDirection, string>> = {
  positive: '▲',
  negative: '▼',
  neutral: '',
}

export function signedTextClass(value: number, deadband = 0): string {
  return SIGNED_TEXT_CLASS[signedDirection(value, deadband)]
}

export function signedPillClass(value: number, deadband = 0): string {
  return SIGNED_PILL_CLASS[signedDirection(value, deadband)]
}
