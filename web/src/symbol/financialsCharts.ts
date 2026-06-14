// Pure shaping for the Financials revenue-trend bars: extract revenue per
// period from the statements response, order oldest→newest (the response comes
// newest-first), and compute the period-over-period delta against the previous
// AVAILABLE bar so a gap doesn't blank out the next delta.

import { findLineValue, type GetStatementsResponse } from './statements.ts'

export type RevenueBar = {
  period: string
  value: number
  // Fractional change vs the previous available bar; null for the first.
  deltaPct: number | null
}

export function revenueBarsFromStatements(response: GetStatementsResponse): RevenueBar[] {
  const ascending = [...response.results].reverse()
  const bars: RevenueBar[] = []
  for (const entry of ascending) {
    const revenue = entry.outcome.outcome === 'available' ? findLineValue(entry.outcome.data, 'revenue') : null
    if (revenue === null) continue
    const prev = bars[bars.length - 1]
    bars.push({
      period: entry.period,
      value: revenue,
      deltaPct: prev && prev.value !== 0 ? (revenue - prev.value) / prev.value : null,
    })
  }
  return bars
}

// '2024-FY' → 'FY24'; '2024-Q3' → "Q3'24"; anything else passes through.
export function formatPeriodLabel(period: string): string {
  const match = period.match(/^(\d{4})-(FY|Q[1-4])$/)
  if (!match) return period
  const [, year, kind] = match
  const yy = year.slice(2)
  return kind === 'FY' ? `FY${yy}` : `${kind}'${yy}`
}
