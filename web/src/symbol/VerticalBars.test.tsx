import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToString } from 'react-dom/server'

import { VerticalBars } from './VerticalBars.tsx'

test('VerticalBars normalizes heights to the largest value', () => {
  const html = renderToString(
    <VerticalBars
      bars={[
        { key: 'a', value: 0 },
        { key: 'b', value: 5 },
        { key: 'c', value: 10 },
      ]}
      minBarPct={6}
      ariaLabel="demo"
    />,
  )
  assert.match(html, /height:0%/) // the zero bar collapses
  assert.match(html, /height:50%/) // 5 / 10
  assert.match(html, /height:100%/) // the max bar
  assert.match(html, /role="img"/)
  assert.match(html, /aria-label="demo"/)
})

test('VerticalBars gives a non-zero bar at least minBarPct and is decorative without a label', () => {
  const html = renderToString(
    <VerticalBars bars={[{ key: 'a', value: 1 }, { key: 'b', value: 100 }]} minBarPct={8} />,
  )
  assert.match(html, /height:8%/) // 1/100 would be 1%, floored up to the minimum
  assert.match(html, /aria-hidden="true"/)
  assert.doesNotMatch(html, /role="img"/)
})

test('VerticalBars renders all bars at 0% when every value is zero', () => {
  const html = renderToString(<VerticalBars bars={[{ key: 'a', value: 0 }, { key: 'b', value: 0 }]} />)
  assert.equal((html.match(/height:0%/g) ?? []).length, 2)
})
