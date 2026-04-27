// Tiny SVG line chart shared by symbol-detail surfaces. Two modes:
//   - domain: 'auto' picks min/max from the points (price-style sparklines)
//   - domain: [lo, hi] pins the y-range (sentiment scores in [-1, 1] etc.)
// `baseline` optionally draws a dashed reference line (e.g. the 0 baseline
// for sentiment); pass null to omit.

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 80
const PAD_X = 4
const PAD_Y = 6

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
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}: SparklineProps) {
  if (values.length < 2) return null
  const innerW = width - PAD_X * 2
  const innerH = height - PAD_Y * 2
  const [lo, hi] = resolveDomain(values, domain)
  const span = hi - lo || 1
  const path = values
    .map((value, i) => {
      const x = PAD_X + (i / (values.length - 1)) * innerW
      const y = PAD_Y + (1 - (value - lo) / span) * innerH
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const baselineY =
    baseline === null ? null : PAD_Y + (1 - (baseline - lo) / span) * innerH
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      className="h-20 w-full"
      preserveAspectRatio="none"
    >
      {baselineY !== null && (
        <line
          x1={PAD_X}
          x2={width - PAD_X}
          y1={baselineY}
          y2={baselineY}
          strokeWidth={1}
          strokeDasharray="2 3"
          className="stroke-neutral-300 dark:stroke-neutral-700"
        />
      )}
      <path d={path} fill="none" strokeWidth={1.5} className={trendStrokeClass} />
    </svg>
  )
}

function resolveDomain(
  values: ReadonlyArray<number>,
  domain: 'auto' | readonly [number, number],
): readonly [number, number] {
  if (domain !== 'auto') return domain
  let lo = values[0]
  let hi = values[0]
  for (let i = 1; i < values.length; i++) {
    if (values[i] < lo) lo = values[i]
    if (values[i] > hi) hi = values[i]
  }
  return [lo, hi]
}
