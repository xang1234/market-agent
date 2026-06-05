import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { PriceTargetRange } from './PriceTargetRange.tsx'
import { priceTargetRangeFixture } from './fixtures.ts'
import { validateBlock } from './BlockValidator.ts'
import type { PriceTargetRangeBlock } from './types.ts'

test('the price_target_range fixture validates against the schema (display allowed)', () => {
  const result = validateBlock(priceTargetRangeFixture)
  assert.equal(result.valid, true, result.valid ? '' : JSON.stringify(result.errors, null, 2))
})

test('PriceTargetRange renders a range bar with markers and formatted prices', () => {
  const html = renderToStaticMarkup(<PriceTargetRange block={priceTargetRangeFixture} />)
  assert.match(html, /\$170\.00/)
  assert.match(html, /\$280\.00/)
  assert.match(html, /\$214\.50/)
  // avg marker positioned from display.avg.position (45.45%)
  assert.match(html, /left:45\.45/)
  assert.match(html, /price-target-range-.*-avg-marker/)
})

test('PriceTargetRange falls back to the em-dash grid when display is absent', () => {
  const block: PriceTargetRangeBlock = {
    id: 'ptr-empty', kind: 'price_target_range', snapshot_id: '11111111-1111-4111-9111-111111111111',
    data_ref: { kind: 'price_target_range', id: 'ptr-empty' }, source_refs: [], as_of: '2026-06-04T00:00:00.000Z',
    current_price_ref: 'eeeeeeee-1111-4111-9111-aaaaaaaaaaaa', low_ref: 'eeeeeeee-1111-4111-9111-bbbbbbbbbbbb',
    avg_ref: 'eeeeeeee-1111-4111-9111-cccccccccccc', high_ref: 'eeeeeeee-1111-4111-9111-dddddddddddd',
  }
  const html = renderToStaticMarkup(<PriceTargetRange block={block} />)
  assert.match(html, /—/)
})
