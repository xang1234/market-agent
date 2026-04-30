import assert from 'node:assert/strict'
import test from 'node:test'

import { computeVirtualWindow } from './virtualWindow.ts'

test('computeVirtualWindow handles an empty list', () => {
  const result = computeVirtualWindow({
    itemHeights: [],
    scrollTop: 0,
    viewportHeight: 800,
    overscan: 4,
  })
  assert.deepEqual(result, { startIndex: 0, endIndex: -1, paddingTop: 0, paddingBottom: 0 })
})

test('computeVirtualWindow at scrollTop=0 includes the first items plus overscan tail', () => {
  // 1000 items @ 200px each. Viewport 800px = 4 visible. Overscan 4 → mount
  // items 0..7 (no head overscan possible at top).
  const itemHeights = new Array(1000).fill(200)
  const result = computeVirtualWindow({
    itemHeights,
    scrollTop: 0,
    viewportHeight: 800,
    overscan: 4,
  })
  assert.equal(result.startIndex, 0)
  assert.equal(result.endIndex, 7)
  assert.equal(result.paddingTop, 0)
  // 1000 total - 8 rendered = 992 items @ 200px after the rendered range.
  assert.equal(result.paddingBottom, 992 * 200)
})

test('computeVirtualWindow centered scroll mounts a small window with both spacers', () => {
  const itemHeights = new Array(1000).fill(200)
  // ScrollTop at item 500's top: 500 * 200 = 100000.
  const result = computeVirtualWindow({
    itemHeights,
    scrollTop: 100000,
    viewportHeight: 800,
    overscan: 4,
  })
  // Visible: 500..503 (4 items at 200px in 800px viewport).
  // Overscan ±4 → rendered range 496..507 (12 items).
  assert.equal(result.startIndex, 496)
  assert.equal(result.endIndex, 507)
  assert.equal(result.paddingTop, 496 * 200)
  assert.equal(result.paddingBottom, (1000 - 508) * 200)
})

test('computeVirtualWindow at the bottom clamps endIndex to the last item', () => {
  const itemHeights = new Array(1000).fill(200)
  const totalHeight = 1000 * 200 // 200000
  // ScrollTop near the very bottom.
  const result = computeVirtualWindow({
    itemHeights,
    scrollTop: totalHeight - 800,
    viewportHeight: 800,
    overscan: 4,
  })
  assert.equal(result.endIndex, 999)
  // Window covers the last 4 visible + 4 head overscan = items 992..999.
  assert.equal(result.startIndex, 992)
  assert.equal(result.paddingBottom, 0)
  assert.equal(result.paddingTop, 992 * 200)
})

test('computeVirtualWindow handles variable-height items via cumulative measurement', () => {
  // 5 items with non-uniform heights. Cumulative tops:
  //   item 0: top 0,   bottom 100
  //   item 1: top 100, bottom 400  (300px)
  //   item 2: top 400, bottom 600  (200px)
  //   item 3: top 600, bottom 1100 (500px)
  //   item 4: top 1100, bottom 1300 (200px)
  // Viewport 200px starting at scrollTop 350: spans 350..550 → items 1 and 2.
  const result = computeVirtualWindow({
    itemHeights: [100, 300, 200, 500, 200],
    scrollTop: 350,
    viewportHeight: 200,
    overscan: 0,
  })
  assert.equal(result.startIndex, 1)
  assert.equal(result.endIndex, 2)
  assert.equal(result.paddingTop, 100)
  assert.equal(result.paddingBottom, 700)
})

test('computeVirtualWindow rendered window stays bounded by viewport+overscan, not by total items', () => {
  // Core perf invariant: the number of rendered items must be O(viewport),
  // independent of total list size. This is what gives the 60fps contract
  // for 1000-message threads — only ~10-20 components ever mount at once.
  const fewHeights = new Array(50).fill(200)
  const manyHeights = new Array(10000).fill(200)
  const sharedInput = { scrollTop: 4000, viewportHeight: 800, overscan: 4 }

  const fewResult = computeVirtualWindow({ ...sharedInput, itemHeights: fewHeights })
  const manyResult = computeVirtualWindow({ ...sharedInput, itemHeights: manyHeights })

  const fewRendered = fewResult.endIndex - fewResult.startIndex + 1
  const manyRendered = manyResult.endIndex - manyResult.startIndex + 1
  assert.equal(fewRendered, manyRendered, 'rendered count must not depend on total list length')
  // Visible 4 + overscan 8 (±4) = 12.
  assert.equal(manyRendered, 12)
})

test('computeVirtualWindow is fast enough for the 60fps contract on 1000-item threads', () => {
  // The 60fps budget is 16.67ms per frame. Windowing should be a tiny slice
  // of that — assert it stays well under at the 1k scale (the bead's contract
  // size). Allowing 5ms total for 100 invocations is generous (~50µs each)
  // and leaves headroom for the React render pass.
  const itemHeights = new Array(1000).fill(200)
  const totalHeight = itemHeights.length * 200
  const start = performance.now()
  for (let i = 0; i < 100; i++) {
    const scrollTop = (i / 100) * (totalHeight - 800)
    computeVirtualWindow({
      itemHeights,
      scrollTop,
      viewportHeight: 800,
      overscan: 4,
    })
  }
  const elapsed = performance.now() - start
  assert.ok(elapsed < 50, `100 windowing calls over 1000 items took ${elapsed.toFixed(2)}ms — perf regression`)
})

test('computeVirtualWindow clamps a negative scrollTop to 0 instead of returning an invalid window', () => {
  // iOS rubber-band scrolling can momentarily report negative scrollTop.
  // Without clamping, the linear scan would set firstVisible=total (no item's
  // bottom > negative scrollTop reached the break) and produce a degenerate
  // window. The clamp keeps the head visible during overscroll.
  const itemHeights = new Array(10).fill(100)
  const result = computeVirtualWindow({
    itemHeights,
    scrollTop: -50,
    viewportHeight: 400,
    overscan: 2,
  })
  assert.equal(result.startIndex, 0)
  assert.ok(result.endIndex >= 3, `expected at least 4 visible items, got endIndex=${result.endIndex}`)
})
