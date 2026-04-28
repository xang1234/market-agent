import type { ReactElement } from 'react'
import type { Series } from './types.ts'
import { computeSeriesGeometry } from './seriesGeometry.ts'

const SERIES_PALETTE: ReadonlyArray<{ stroke: string; bg: string }> = [
  { stroke: 'stroke-blue-500', bg: 'bg-blue-500' },
  { stroke: 'stroke-emerald-500', bg: 'bg-emerald-500' },
  { stroke: 'stroke-amber-500', bg: 'bg-amber-500' },
  { stroke: 'stroke-rose-500', bg: 'bg-rose-500' },
  { stroke: 'stroke-violet-500', bg: 'bg-violet-500' },
  { stroke: 'stroke-teal-500', bg: 'bg-teal-500' },
]

type SeriesChartProps = {
  testId: string
  ariaLabel: string
  series: ReadonlyArray<Series>
  width?: number
  height?: number
}

export function SeriesChart({
  testId,
  ariaLabel,
  series,
  width,
  height,
}: SeriesChartProps): ReactElement | null {
  const geometry = computeSeriesGeometry(series, { width, height })
  if (geometry === null) return null

  return (
    <div data-testid={testId} className="flex flex-col gap-2">
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
      >
        {geometry.paths.map((path, index) => (
          <path
            key={`${testId}-path-${index}`}
            d={path.d}
            fill="none"
            strokeWidth={1.5}
            className={SERIES_PALETTE[index % SERIES_PALETTE.length].stroke}
          />
        ))}
      </svg>
      <SeriesLegend testId={testId} series={geometry.paths} />
    </div>
  )
}

type SeriesLegendProps = {
  testId: string
  series: ReadonlyArray<{ name: string; unit: string | undefined }>
}

function SeriesLegend({ testId, series }: SeriesLegendProps): ReactElement | null {
  if (series.length === 0) return null
  return (
    <ul
      data-testid={`${testId}-legend`}
      className="flex flex-wrap gap-3 text-xs text-neutral-600 dark:text-neutral-400"
    >
      {series.map((s, index) => (
        <li
          key={`${testId}-legend-${index}`}
          className="flex items-center gap-1"
        >
          <span
            aria-hidden
            className={`inline-block h-2 w-3 rounded ${SERIES_PALETTE[index % SERIES_PALETTE.length].bg}`}
          />
          <span>{s.name}</span>
          {s.unit !== undefined && s.unit.length > 0 ? (
            <span className="text-neutral-400">({s.unit})</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
