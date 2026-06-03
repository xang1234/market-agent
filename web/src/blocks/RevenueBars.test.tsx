import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { RevenueBars } from './RevenueBars.tsx'
import { revenueBarsFixture } from './fixtures.ts'
import { validateBlock } from './BlockValidator.ts'
import type { RevenueBarsBlock } from './types.ts'

test('the revenue_bars fixture validates against the block schema (magnitude+format allowed)', () => {
  const result = validateBlock(revenueBarsFixture)
  assert.equal(result.valid, true, result.valid ? '' : JSON.stringify(result.errors, null, 2))
})

test('RevenueBars renders heights from magnitude and labels from format', () => {
  const html = renderToStaticMarkup(<RevenueBars block={revenueBarsFixture} />)
  // Peak bar -> 100% height; a mid bar -> 60%.
  assert.match(html, /height:100%/)
  assert.match(html, /height:60%/)
  // Pre-formatted values render as text.
  assert.match(html, /\$5\.0B/)
  assert.match(html, /\$3\.0B/)
})

test('RevenueBars falls back to a stub height + em-dash when magnitude/format are absent', () => {
  const block: RevenueBarsBlock = {
    id: 'rb-empty',
    kind: 'revenue_bars',
    snapshot_id: '11111111-1111-4111-9111-111111111111',
    data_ref: { kind: 'revenue_bars', id: 'rb-empty' },
    source_refs: [],
    as_of: '2026-03-31T00:00:00.000Z',
    bars: [{ label: 'Q1 FY24', value_ref: '11111111-1111-4111-9111-aaaaaaaaaaaa' }],
  }
  const html = renderToStaticMarkup(<RevenueBars block={block} />)
  assert.match(html, /height:60%/)
  assert.match(html, /—/)
})
