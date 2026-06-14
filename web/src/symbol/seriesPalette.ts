// Hex mirror of SeriesChart's Tailwind-500 series palette, for SVG fills that
// need a concrete color value (e.g. donut arcs) rather than a stroke class.
// Keep the order in sync with SeriesChart's SERIES_PALETTE so a subject's
// segment colors match wherever it's charted.
export const SERIES_HEX: ReadonlyArray<string> = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#f43f5e', // rose-500
  '#8b5cf6', // violet-500
  '#14b8a6', // teal-500
]

export function seriesHexAt(index: number): string {
  return SERIES_HEX[index % SERIES_HEX.length]
}
