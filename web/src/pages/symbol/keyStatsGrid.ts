// Pure assembly of the dense key-stats grid shown under the symbol hero chart.
// Prev close comes from the authoritative quote; open / day range / volume from
// the latest daily bar; fundamentals (P/E, margins, revenue growth) from the
// key-stats envelope. Only cells whose provider exists are emitted — a cell may
// still be null for a given subject (data not reported), rendering a dash, but
// the grid never ships tiles that can never carry data.

import type { NormalizedBar } from '../../symbol/series.ts'
import { formatQuotePrice } from '../../symbol/quote.ts'
import { formatStatValue, statLabel, type KeyStatKey, type KeyStatsEnvelope } from '../../symbol/stats.ts'

export type KeyStatCell = {
  key: string
  label: string
  // null → the value is unavailable for this subject; renderer shows a dash.
  value: string | null
  // The queried subject's prior close anchors the page — emphasize it.
  emphasis?: boolean
}

export type KeyStatsGridInput = {
  bars: ReadonlyArray<NormalizedBar> | null
  stats: KeyStatsEnvelope | null
  // Authoritative prior-session close from the quote (not derived from bars).
  prevClose: number | null
  currency: string
}

export function formatCompactNumber(value: number): string {
  const units: ReadonlyArray<readonly [number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [base, suffix] of units) {
    if (Math.abs(value) >= base) return `${(value / base).toFixed(2)}${suffix}`
  }
  return value.toLocaleString('en-US')
}

const FUNDAMENTAL_CELLS: ReadonlyArray<KeyStatKey> = [
  'pe_ratio',
  'gross_margin',
  'operating_margin',
  'net_margin',
  'revenue_growth_yoy',
]

export function buildKeyStatsGrid(input: KeyStatsGridInput): ReadonlyArray<KeyStatCell> {
  const { bars, stats, prevClose, currency } = input
  const last = bars && bars.length > 0 ? bars[bars.length - 1] : null
  const statByKey = new Map((stats?.stats ?? []).map((s) => [s.stat_key, s] as const))

  const priceCells: KeyStatCell[] = [
    {
      key: 'prev_close',
      label: 'Prev close',
      value: prevClose !== null ? formatQuotePrice(prevClose, currency) : null,
      emphasis: true,
    },
    { key: 'open', label: 'Open', value: last ? formatQuotePrice(last.open, currency) : null },
    {
      key: 'day_range',
      label: 'Day range',
      value: last ? `${formatQuotePrice(last.low, currency)} – ${formatQuotePrice(last.high, currency)}` : null,
    },
    { key: 'volume', label: 'Volume', value: last ? formatCompactNumber(last.volume) : null },
  ]

  const fundamentalCells: KeyStatCell[] = FUNDAMENTAL_CELLS.map((key) => {
    const stat = statByKey.get(key)
    return { key, label: statLabel(key), value: stat ? formatStatValue(stat) : null }
  })

  return [...priceCells, ...fundamentalCells]
}
