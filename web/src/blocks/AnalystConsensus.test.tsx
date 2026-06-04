import assert from 'node:assert/strict'
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { AnalystConsensus } from './AnalystConsensus.tsx'
import { analystConsensusFixture } from './fixtures.ts'
import { validateBlock } from './BlockValidator.ts'
import type { AnalystConsensusBlock } from './types.ts'

test('the analyst_consensus fixture validates against the schema (count allowed)', () => {
  const result = validateBlock(analystConsensusFixture)
  assert.equal(result.valid, true, result.valid ? '' : JSON.stringify(result.errors, null, 2))
})

test('AnalystConsensus renders a stacked bar with counts and a total', () => {
  const html = renderToStaticMarkup(<AnalystConsensus block={analystConsensusFixture} />)
  // 41 total ratings (14+17+8+1+1), each bucket count shown.
  assert.match(html, /41 ratings/)
  assert.match(html, /rating-segment-0/)
  // Strong Buy is 14/41 ≈ 34.146% width.
  assert.match(html, /width:34\.146/)
})

test('AnalystConsensus falls back to em-dashes when buckets lack counts', () => {
  const block: AnalystConsensusBlock = {
    id: 'ac-empty',
    kind: 'analyst_consensus',
    snapshot_id: '11111111-1111-4111-9111-111111111111',
    data_ref: { kind: 'analyst_consensus', id: 'ac-empty' },
    source_refs: [],
    as_of: '2026-06-04T00:00:00.000Z',
    analyst_count_ref: 'dddddddd-1111-4111-9111-111111111111',
    distribution: [{ bucket: 'Strong Buy', count_ref: 'dddddddd-1111-4111-9111-111111111aaa' }],
  }
  const html = renderToStaticMarkup(<AnalystConsensus block={block} />)
  assert.match(html, /—/)
})
