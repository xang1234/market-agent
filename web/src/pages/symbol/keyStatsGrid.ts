// Pure assembly of the dense key-stats grid shown under the symbol hero chart.
// Pulls intraday cells (prev close, open, day range, volume) from the latest
// two daily bars and fundamental cells (P/E, margins, revenue growth) from the
// key-stats envelope. Cells whose data provider isn't wired yet (market cap,
// 52-wk range, beta) carry a null value and render as a dash — the grid keeps
// a complete shape without fabricating numbers.

import type { NormalizedBar } from '../../symbol/series.ts'
import { formatQuotePrice } from '../../symbol/quote.ts'
import { formatStatValue, statLabel, type KeyStatKey, type KeyStatsEnvelope } from '../../symbol/stats.ts'

export type KeyStatCell = {
  key: string
  label: string
  // null → the value is unavailable; the renderer shows a subdued dash.
  value: string | null
  // The queried subject's prior close anchors the page — emphasize it.
  emphasis?: boolean
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

export function buildKeyStatsGrid(
  bars: ReadonlyArray<NormalizedBar> | null,
  stats: KeyStatsEnvelope | null,
  currency: string,
): ReadonlyArray<KeyStatCell> {
  const last = bars && bars.length > 0 ? bars[bars.length - 1] : null
  const prev = bars && bars.length >= 2 ? bars[bars.length - 2].close : null
  const statByKey = new Map((stats?.stats ?? []).map((s) => [s.stat_key, s] as const))

  const priceCells: KeyStatCell[] = [
    {
      key: 'prev_close',
      label: 'Prev close',
      value: prev !== null ? formatQuotePrice(prev, currency) : null,
      emphasis: true,
    },
    { key: 'open', label: 'Open', value: last ? formatQuotePrice(last.open, currency) : null },
    {
      key: 'day_range',
      label: 'Day range',
      value: last ? `${formatQuotePrice(last.low, currency)} – ${formatQuotePrice(last.high, currency)}` : null,
    },
    { key: 'volume', label: 'Volume', value: last ? formatCompactNumber(last.volume) : null },
    { key: 'fifty_two_week', label: '52-wk range', value: null },
    { key: 'market_cap', label: 'Market cap', value: null },
  ]

  const fundamentalCells: KeyStatCell[] = FUNDAMENTAL_CELLS.map((key) => {
    const stat = statByKey.get(key)
    return { key, label: statLabel(key), value: stat ? formatStatValue(stat) : null }
  })

  return [...priceCells, ...fundamentalCells, { key: 'beta', label: 'Beta', value: null }]
}
