// Pure shaping for the Earnings beat/miss strip: take the most recent N
// releases (chronological, oldest→newest), derive a direction per quarter, and
// summarize the streak. Sorted by fiscal year+quarter so it doesn't depend on
// the envelope's array order.

import type { EarningsEvent, EarningsSurpriseDirection } from './earnings.ts'

export type BeatMissChip = {
  key: string
  fiscalYear: number
  fiscalPeriod: string
  direction: EarningsSurpriseDirection
  surprisePct: number | null
}

export type BeatMissSummary = {
  chips: ReadonlyArray<BeatMissChip>
  beatCount: number
  total: number
  avgSurprisePct: number | null
}

function quarterRank(fiscalPeriod: string): number {
  const match = fiscalPeriod.match(/^Q([1-4])$/)
  return match ? Number(match[1]) : 5 // FY / annual sorts after the quarters
}

function chronoKey(event: EarningsEvent): number {
  return event.fiscal_year * 10 + quarterRank(event.fiscal_period)
}

function direction(event: EarningsEvent): EarningsSurpriseDirection {
  if (event.surprise_direction !== null) return event.surprise_direction
  if (event.surprise_pct === null) return 'inline'
  return event.surprise_pct >= 0 ? 'beat' : 'miss'
}

export function beatMissSummary(
  events: ReadonlyArray<EarningsEvent>,
  count: number,
): BeatMissSummary {
  const chips = [...events]
    .sort((a, b) => chronoKey(a) - chronoKey(b))
    .slice(-count)
    .map((event) => ({
      key: `${event.fiscal_year}-${event.fiscal_period}`,
      fiscalYear: event.fiscal_year,
      fiscalPeriod: event.fiscal_period,
      direction: direction(event),
      surprisePct: event.surprise_pct,
    }))

  const withPct = chips.filter((c) => c.surprisePct !== null)
  const avgSurprisePct =
    withPct.length === 0 ? null : withPct.reduce((sum, c) => sum + (c.surprisePct ?? 0), 0) / withPct.length

  return {
    chips,
    beatCount: chips.filter((c) => c.direction === 'beat').length,
    total: chips.length,
    avgSurprisePct,
  }
}
