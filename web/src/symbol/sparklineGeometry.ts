// Pure path/baseline computation for the <Sparkline> SVG. Split out so the
// flat-series and domain-boundary cases stay testable without a DOM renderer
// (and so Sparkline.tsx satisfies react-refresh/only-export-components).

export const SPARKLINE_DEFAULTS = {
  width: 320,
  height: 80,
  padX: 4,
  padY: 6,
} as const

export type SparklineGeometry = {
  path: string
  baselineY: number | null
}

export type SparklineGeometryInput = {
  values: ReadonlyArray<number>
  domain?: 'auto' | readonly [number, number]
  baseline?: number | null
  width?: number
  height?: number
}

export function computeSparklineGeometry({
  values,
  domain = 'auto',
  baseline = null,
  width = SPARKLINE_DEFAULTS.width,
  height = SPARKLINE_DEFAULTS.height,
}: SparklineGeometryInput): SparklineGeometry | null {
  if (values.length < 2) return null
  const { padX, padY } = SPARKLINE_DEFAULTS
  const innerW = width - padX * 2
  const innerH = height - padY * 2
  const [lo, hi] = resolveDomain(values, domain)
  const rawSpan = hi - lo
  // Flat series: every value identical. Without this guard, (value - lo)/span
  // is 0 and the path lands at the bottom — reads as "values plummeted to
  // floor" rather than "no change". Center the path (and any baseline that
  // happens to coincide with the flat value) on the mid-line instead.
  const span = rawSpan === 0 ? 1 : rawSpan
  const midY = padY + innerH / 2
  const path = values
    .map((value, i) => {
      const x = padX + (i / (values.length - 1)) * innerW
      const y = rawSpan === 0 ? midY : padY + (1 - (value - lo) / span) * innerH
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const baselineY =
    baseline === null
      ? null
      : rawSpan === 0
        ? midY
        : padY + (1 - (baseline - lo) / span) * innerH
  return { path, baselineY }
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
