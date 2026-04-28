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
