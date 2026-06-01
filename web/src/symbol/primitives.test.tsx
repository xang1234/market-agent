import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { SectorChip } from './SectorChip.tsx'
import { StackedBar } from './StackedBar.tsx'
import { RangeSlider } from './RangeSlider.tsx'
import { SeverityBadge } from '../blocks/SeverityBadge.tsx'

test('SectorChip renders its label with the violet soft tint', () => {
  const html = renderToStaticMarkup(<SectorChip>Technology</SectorChip>)
  assert.match(html, /Technology/)
  assert.match(html, /bg-violet-soft/)
  assert.match(html, /text-violet/)
})

test('SeverityBadge maps severity to a tone and a default label', () => {
  assert.match(renderToStaticMarkup(<SeverityBadge severity="high" />), /text-negative/)
  assert.match(renderToStaticMarkup(<SeverityBadge severity="high" />), /High/)
  assert.match(renderToStaticMarkup(<SeverityBadge severity="medium" />), /text-warning/)
  assert.match(renderToStaticMarkup(<SeverityBadge severity="low" />), /text-muted/)
})

test('StackedBar sizes segments proportionally to their values', () => {
  const html = renderToStaticMarkup(
    <StackedBar
      segments={[
        { label: 'Buy', value: 30, barClass: 'bg-positive' },
        { label: 'Hold', value: 10, barClass: 'bg-warning' },
      ]}
    />,
  )
  // 30 / 40 = 75%, 10 / 40 = 25%.
  assert.match(html, /width:75%/)
  assert.match(html, /width:25%/)
  // Legend shows both counts.
  assert.match(html, /Buy/)
  assert.match(html, /30/)
})

test('StackedBar with a zero total renders an empty track (no divide-by-zero)', () => {
  const html = renderToStaticMarkup(
    <StackedBar segments={[{ label: 'Buy', value: 0, barClass: 'bg-positive' }]} />,
  )
  assert.doesNotMatch(html, /width:/)
})

test('RangeSlider places the marker proportionally and clamps out-of-band values', () => {
  const inBand = renderToStaticMarkup(
    <RangeSlider low={100} current={150} high={200} lowLabel="$100" currentLabel="$150" highLabel="$200" />,
  )
  // (150 - 100) / (200 - 100) = 50%.
  assert.match(inBand, /left:50%/)

  const aboveBand = renderToStaticMarkup(
    <RangeSlider low={100} current={300} high={200} lowLabel="$100" currentLabel="$300" highLabel="$200" />,
  )
  // Clamped to the high edge.
  assert.match(aboveBand, /left:100%/)
})
