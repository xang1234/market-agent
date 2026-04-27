import assert from 'node:assert/strict'
import test from 'node:test'
import { computeSparklineGeometry, SPARKLINE_DEFAULTS } from './sparklineGeometry.ts'

const { padY, height } = SPARKLINE_DEFAULTS
const INNER_H = height - padY * 2
const MID_Y = padY + INNER_H / 2

test('computeSparklineGeometry returns null for fewer than 2 values (no path to draw)', () => {
  assert.equal(computeSparklineGeometry({ values: [] }), null)
  assert.equal(computeSparklineGeometry({ values: [1] }), null)
})

test('auto-domain rising series: last point sits above the first (smaller y = higher on screen)', () => {
  const geometry = computeSparklineGeometry({ values: [1, 2, 3, 4] })
  assert.ok(geometry !== null)
  const ys = parseAllY(geometry!.path)
  assert.ok(
    ys[ys.length - 1] < ys[0],
    `last y (${ys[ys.length - 1]}) should be smaller than first y (${ys[0]}) for rising series`,
  )
})

test('auto-domain flat series stays centered on the mid-line (regression: was rendering at the bottom)', () => {
  const geometry = computeSparklineGeometry({ values: [5, 5, 5, 5] })
  assert.ok(geometry !== null)
  for (const y of parseAllY(geometry!.path)) {
    assert.ok(
      Math.abs(y - MID_Y) < 0.01,
      `flat series y should be ~${MID_Y} (mid-line), got ${y}`,
    )
  }
})

test('fixed domain [-1, 1] places +1 at the top, 0 at the middle, -1 at the bottom', () => {
  const geometry = computeSparklineGeometry({ values: [-1, 0, 1], domain: [-1, 1] })
  assert.ok(geometry !== null)
  const ys = parseAllY(geometry!.path)
  assert.ok(Math.abs(ys[0] - (padY + INNER_H)) < 0.01, `value -1 should land at the bottom`)
  assert.ok(Math.abs(ys[1] - MID_Y) < 0.01, `value 0 should land at the mid-line`)
  assert.ok(Math.abs(ys[2] - padY) < 0.01, `value +1 should land at the top`)
})

test('baseline within the domain renders at the correct y; flat-series baseline coincides with mid-line', () => {
  const ranged = computeSparklineGeometry({ values: [-1, 1], domain: [-1, 1], baseline: 0 })
  assert.ok(ranged !== null)
  assert.ok(
    Math.abs(ranged!.baselineY! - MID_Y) < 0.01,
    `baseline 0 in [-1, 1] should sit on the mid-line`,
  )

  const flat = computeSparklineGeometry({ values: [5, 5, 5], baseline: 5 })
  assert.ok(flat !== null)
  assert.ok(
    Math.abs(flat!.baselineY! - MID_Y) < 0.01,
    'flat-series baseline should sit on the mid-line, not at the bottom',
  )
})

test('baseline=null returns baselineY=null so the dashed line is omitted from the SVG', () => {
  const geometry = computeSparklineGeometry({ values: [1, 2, 3], baseline: null })
  assert.ok(geometry !== null)
  assert.equal(geometry!.baselineY, null)
})

test('path begins with M (move) and continues with L (line) commands', () => {
  const geometry = computeSparklineGeometry({ values: [1, 2, 3] })
  assert.ok(geometry !== null)
  assert.match(geometry!.path, /^M [\d.]+,[\d.]+ L [\d.]+,[\d.]+ L [\d.]+,[\d.]+$/)
})

function parseAllY(path: string): number[] {
  const matches = [...path.matchAll(/[ML] ([\d.]+),([\d.]+)/g)]
  return matches.map((m) => Number(m[2]))
}
