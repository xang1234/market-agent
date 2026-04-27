// Tiny SVG line chart shared by symbol-detail surfaces. Two modes:
//   - domain: 'auto' picks min/max from the points (price-style sparklines)
//   - domain: [lo, hi] pins the y-range (sentiment scores in [-1, 1] etc.)
// `baseline` optionally draws a dashed reference line (e.g. the 0 baseline
// for sentiment); pass null to omit.
//
// Path/baseline math lives in sparklineGeometry.ts so the flat-series and
// domain-boundary branches stay testable without a React renderer.

import { computeSparklineGeometry, SPARKLINE_DEFAULTS } from './sparklineGeometry.ts'

type SparklineProps = {
  values: ReadonlyArray<number>
  ariaLabel: string
  trendStrokeClass: string
  domain?: 'auto' | readonly [number, number]
  baseline?: number | null
  width?: number
  height?: number
}

export function Sparkline({
  values,
  ariaLabel,
  trendStrokeClass,
  domain = 'auto',
  baseline = null,
  width = SPARKLINE_DEFAULTS.width,
  height = SPARKLINE_DEFAULTS.height,
}: SparklineProps) {
  const geometry = computeSparklineGeometry({ values, domain, baseline, width, height })
  if (geometry === null) return null
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      className="h-20 w-full"
      preserveAspectRatio="none"
    >
      {geometry.baselineY !== null && (
        <line
          x1={SPARKLINE_DEFAULTS.padX}
          x2={width - SPARKLINE_DEFAULTS.padX}
          y1={geometry.baselineY}
          y2={geometry.baselineY}
          strokeWidth={1}
          strokeDasharray="2 3"
          className="stroke-neutral-300 dark:stroke-neutral-700"
        />
      )}
      <path d={geometry.path} fill="none" strokeWidth={1.5} className={trendStrokeClass} />
    </svg>
  )
}
