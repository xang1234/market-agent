import { computeSparklineGeometry } from '../symbol/sparklineGeometry.ts'
import type { Series } from './types.ts'

export const SERIES_CHART_DEFAULTS = {
  width: 480,
  height: 160,
} as const

// One plotted point in chart-pixel space, for crosshair hover lookup.
export type SeriesChartPoint = {
  x: number
  y: number
  value: number
  xLabel: string | number | undefined
}

export type SeriesPath = {
  name: string
  unit: string | undefined
  d: string
  // Closed area path (down to the floor) for a single-series gradient fill.
  areaPath: string
  // End-of-line anchor for the series label.
  end: { x: number; y: number }
  // Per-point pixel coordinates (same scale math as `d`).
  points: ReadonlyArray<SeriesChartPoint>
}

export type SeriesGeometry = {
  paths: ReadonlyArray<SeriesPath>
  yDomain: readonly [number, number]
  width: number
  height: number
}

export function computeSeriesYDomain(series: ReadonlyArray<Series>): readonly [number, number] | null {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const s of series) {
    for (const point of s.points) {
      if (point.y < lo) lo = point.y
      if (point.y > hi) hi = point.y
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  return [lo, hi]
}

// Builds one SVG path per series, sharing a y-domain so multiple series
// fit on the same plot. Re-uses sparklineGeometry's path math (flat-series
// + baseline edge cases stay covered by its existing tests).
export function computeSeriesGeometry(
  series: ReadonlyArray<Series>,
  options: { width?: number; height?: number } = {},
): SeriesGeometry | null {
  const width = options.width ?? SERIES_CHART_DEFAULTS.width
  const height = options.height ?? SERIES_CHART_DEFAULTS.height
  const yDomain = computeSeriesYDomain(series)
  if (yDomain === null) return null

  const paths: SeriesPath[] = []
  for (const s of series) {
    const values = s.points.map((p) => p.y)
    const geom = computeSparklineGeometry({ values, domain: yDomain, width, height })
    if (geom === null) continue
    // Pixel coordinates come straight from the shared projection that built
    // the path, annotated with the data values for hover readouts.
    const points = s.points.map((point, i) => ({
      x: geom.points[i].x,
      y: geom.points[i].y,
      value: point.y,
      xLabel: point.label ?? point.x,
    }))
    paths.push({ name: s.name, unit: s.unit, d: geom.path, areaPath: geom.areaPath, end: geom.end, points })
  }
  if (paths.length === 0) return null
  return { paths, yDomain, width, height }
}
