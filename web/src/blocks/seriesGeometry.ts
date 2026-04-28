import { computeSparklineGeometry } from '../symbol/sparklineGeometry.ts'
import type { Series } from './types.ts'

export const SERIES_CHART_DEFAULTS = {
  width: 480,
  height: 160,
} as const

export type SeriesPath = {
  name: string
  unit: string | undefined
  d: string
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
    paths.push({ name: s.name, unit: s.unit, d: geom.path })
  }
  if (paths.length === 0) return null
  return { paths, yDomain, width, height }
}
