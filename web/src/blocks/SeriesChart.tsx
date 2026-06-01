import { useId, type ReactElement } from 'react'
import type { Series } from './types.ts'
import { computeSeriesGeometry, type SeriesGeometry } from './seriesGeometry.ts'

const SERIES_PALETTE: ReadonlyArray<{ stroke: string; bg: string; text: string }> = [
  { stroke: 'stroke-blue-500', bg: 'bg-blue-500', text: 'text-blue-500' },
  { stroke: 'stroke-emerald-500', bg: 'bg-emerald-500', text: 'text-emerald-500' },
  { stroke: 'stroke-amber-500', bg: 'bg-amber-500', text: 'text-amber-500' },
  { stroke: 'stroke-rose-500', bg: 'bg-rose-500', text: 'text-rose-500' },
  { stroke: 'stroke-violet-500', bg: 'bg-violet-500', text: 'text-violet-500' },
  { stroke: 'stroke-teal-500', bg: 'bg-teal-500', text: 'text-teal-500' },
]

const paletteAt = (index: number) => SERIES_PALETTE[index % SERIES_PALETTE.length]

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
  // useId() contains colons (":r0:") which break url(#…) gradient references.
  const gradientId = `series-fill-${useId().replace(/:/g, '')}`
  if (geometry === null) return null

  // A gradient area fill only reads cleanly under a single line; with multiple
  // overlapping series the translucent fills muddy each other, so the fill is
  // reserved for the single-series (price-style) case. currentColor lets one
  // text-color class drive both the stops and the line.
  const single = geometry.paths.length === 1
  const fillColorClass = single ? paletteAt(0).text : ''

  return (
    <div data-testid={testId} className="flex flex-col gap-2">
      <div className="relative">
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          className={`h-40 w-full ${fillColorClass}`}
          preserveAspectRatio="none"
        >
          {single ? (
            <>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={geometry.paths[0].areaPath} fill={`url(#${gradientId})`} stroke="none" />
            </>
          ) : null}
          {geometry.paths.map((path, index) => (
            <path
              key={`${testId}-path-${index}`}
              d={path.d}
              fill="none"
              strokeWidth={1.5}
              className={paletteAt(index).stroke}
            />
          ))}
        </svg>
        <SeriesEndLabels testId={testId} geometry={geometry} />
      </div>
      <SeriesLegend testId={testId} series={geometry.paths} />
    </div>
  )
}

// End-of-line labels rendered as an HTML overlay rather than SVG <text>: the
// chart uses preserveAspectRatio="none", which stretches inline text, so the
// labels are positioned by percentage over the (relative) chart instead.
function SeriesEndLabels({
  testId,
  geometry,
}: {
  testId: string
  geometry: SeriesGeometry
}): ReactElement {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {geometry.paths.map((path, index) => (
        <span
          key={`${testId}-end-${index}`}
          className={`absolute -translate-x-full -translate-y-1/2 rounded bg-surface/75 px-1 text-[10px] font-medium ${paletteAt(index).text}`}
          style={{
            left: `${(path.end.x / geometry.width) * 100}%`,
            top: `${(path.end.y / geometry.height) * 100}%`,
          }}
        >
          {path.name}
        </span>
      ))}
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
    <ul data-testid={`${testId}-legend`} className="flex flex-wrap gap-3 text-xs text-muted">
      {series.map((s, index) => (
        <li key={`${testId}-legend-${index}`} className="flex items-center gap-1">
          <span aria-hidden className={`inline-block h-2 w-3 rounded ${paletteAt(index).bg}`} />
          <span>{s.name}</span>
          {s.unit !== undefined && s.unit.length > 0 ? (
            <span className="text-faint">({s.unit})</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
