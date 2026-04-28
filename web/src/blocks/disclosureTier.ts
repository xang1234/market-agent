import type { DisclosureTier } from './types.ts'

// delayed_15m and eod intentionally share the neutral class with real_time as the only emphasized
// market-data tier — they are both "non-realtime market data" and should not visually rank against each other.
const TIER_BADGE_CLASS: Readonly<Record<DisclosureTier, string>> = {
  real_time: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  delayed_15m: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
  eod: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
  filing_time: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  estimate: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  candidate: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  tertiary_source: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
}

const TIER_LABEL: Readonly<Record<DisclosureTier, string>> = {
  real_time: 'Real-time',
  delayed_15m: 'Delayed 15m',
  eod: 'End of day',
  filing_time: 'Filing-time',
  estimate: 'Estimate',
  candidate: 'Candidate',
  tertiary_source: 'Tertiary source',
}

export function disclosureTierBadgeClass(tier: DisclosureTier): string {
  return TIER_BADGE_CLASS[tier]
}

export function disclosureTierLabel(tier: DisclosureTier): string {
  return TIER_LABEL[tier]
}
