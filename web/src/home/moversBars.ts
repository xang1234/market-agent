import type { QuoteDirection } from '../symbol/quote.ts'
import { quoteDirection } from './summaryView.ts'
import type { HomeQuoteRow } from './summaryClient.ts'

export type MoverBar = {
  row: HomeQuoteRow
  // 0..1 of the largest absolute move in the set — drives the bar width.
  fraction: number
  direction: QuoteDirection
}

// Quote rows ranked by absolute percentage move, each bar scaled to the biggest
// mover in the set — the charts-first lede for Home's market sections, in place
// of a grid of number tiles. A non-finite move scores 0 so it sorts last and
// draws an empty bar rather than poisoning the max.
export function moversBars(rows: ReadonlyArray<HomeQuoteRow>, topN?: number): MoverBar[] {
  const scored = rows.map((row) => ({
    row,
    abs: Number.isFinite(row.change_pct) ? Math.abs(row.change_pct) : 0,
    direction: quoteDirection(row),
  }))
  const max = scored.reduce((m, s) => Math.max(m, s.abs), 0)
  const ranked = [...scored].sort((a, b) => b.abs - a.abs)
  const limited = topN === undefined ? ranked : ranked.slice(0, topN)
  return limited.map((s) => ({
    row: s.row,
    fraction: max === 0 ? 0 : s.abs / max,
    direction: s.direction,
  }))
}
