import assert from 'node:assert/strict'
import test from 'node:test'
import { computeSeriesGeometry, computeSeriesYDomain } from './seriesGeometry.ts'
import type { Series } from './types.ts'

const seriesA: Series = {
  name: 'A',
  unit: 'USD',
  points: [
    { x: '2024-01', y: 10 },
    { x: '2024-02', y: 12 },
    { x: '2024-03', y: 11 },
  ],
}
const seriesB: Series = {
  name: 'B',
  points: [
    { x: '2024-01', y: 4 },
    { x: '2024-02', y: 6 },
    { x: '2024-03', y: 8 },
  ],
}

test('computeSeriesYDomain spans every point across every series', () => {
  const domain = computeSeriesYDomain([seriesA, seriesB])
  assert.deepEqual(domain, [4, 12])
})

test('computeSeriesYDomain returns null when no series carry any points', () => {
  assert.equal(computeSeriesYDomain([]), null)
  assert.equal(computeSeriesYDomain([{ name: 'empty', points: [] }]), null)
})

test('computeSeriesGeometry produces one path per non-empty series with a shared y-domain', () => {
  const geom = computeSeriesGeometry([seriesA, seriesB])
  assert.ok(geom !== null)
  assert.deepEqual(geom.yDomain, [4, 12])
  assert.equal(geom.paths.length, 2)
  for (const path of geom.paths) {
    assert.ok(path.d.startsWith('M '), 'every path begins with a Move command')
    assert.ok(path.d.includes('L '), 'and continues with at least one Line command')
  }
  assert.equal(geom.paths[0].unit, 'USD')
  assert.equal(geom.paths[1].unit, undefined)
})

test('computeSeriesGeometry skips series with fewer than 2 points but keeps the rest', () => {
  const sparse: Series = { name: 'sparse', points: [{ x: 1, y: 1 }] }
  const geom = computeSeriesGeometry([seriesA, sparse])
  assert.ok(geom !== null)
  assert.equal(geom.paths.length, 1)
  assert.equal(geom.paths[0].name, 'A')
})

test('computeSeriesGeometry returns null if no series can produce a path', () => {
  const empty: Series = { name: 'empty', points: [] }
  const sparse: Series = { name: 'sparse', points: [{ x: 1, y: 1 }] }
  assert.equal(computeSeriesGeometry([empty, sparse]), null)
})

test('computeSeriesGeometry honors width/height overrides', () => {
  const geom = computeSeriesGeometry([seriesA], { width: 100, height: 50 })
  assert.ok(geom !== null)
  assert.equal(geom.width, 100)
  assert.equal(geom.height, 50)
})

test('each path carries an area fill closed to the floor and an end anchor at the right edge', () => {
  const geom = computeSeriesGeometry([seriesA], { width: 100, height: 50 })
  assert.ok(geom !== null)
  const path = geom!.paths[0]
  // Area path extends the line and closes back to a baseline (Z).
  assert.ok(path.areaPath.startsWith(path.d), 'area path begins with the line path')
  assert.ok(path.areaPath.trimEnd().endsWith('Z'), 'area path is a closed polygon')
  // End anchor sits at the right edge (last x = width - padX) and within bounds.
  assert.ok(path.end.x > 90 && path.end.x <= 100, `end.x near right edge, got ${path.end.x}`)
  assert.ok(path.end.y >= 0 && path.end.y <= 50, `end.y within height, got ${path.end.y}`)
})

test('computeSeriesGeometry exposes per-point pixel coordinates', () => {
  const geometry = computeSeriesGeometry(
    [{ name: 'A', points: [{ x: 'Q1', y: 0 }, { x: 'Q2', y: 10 }] }],
    { width: 100, height: 50 },
  )
  assert.ok(geometry !== null)
  const pts = geometry.paths[0].points
  assert.equal(pts.length, 2)
  assert.equal(pts[0].xLabel, 'Q1')
  assert.equal(pts[0].value, 0)
  assert.ok(pts[0].x < pts[1].x, 'x increases left to right')
  assert.ok(pts[0].y > pts[1].y, 'higher value sits higher on the chart (smaller y)')
})

test('per-point coordinates handle a flat series via the mid-line guard', () => {
  const geometry = computeSeriesGeometry(
    [{ name: 'Flat', points: [{ x: 1, y: 5 }, { x: 2, y: 5 }] }],
    { width: 100, height: 50 },
  )
  assert.ok(geometry !== null)
  const pts = geometry.paths[0].points
  assert.equal(pts[0].y, pts[1].y)
  assert.ok(pts[0].y > 0 && pts[0].y < 50, 'flat series centered, not on the floor')
})
