import assert from 'node:assert/strict'
import test from 'node:test'

import { extractInspectableRefs } from './inspectableRefs.ts'

const SNAPSHOT_ID = '11111111-1111-4111-8111-111111111111'
const FACT_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'
const SOURCE_ID = '44444444-4444-4444-8444-444444444444'
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555'
const DELTA_FACT_ID = '66666666-6666-4666-8666-666666666666'

test('extractInspectableRefs derives schema-native refs from blocks', () => {
  const refs = extractInspectableRefs({
    id: 'metric-row-1',
    kind: 'metric_row',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: 'metric_row', id: 'metric-row-1' },
    source_refs: [SOURCE_ID],
    claim_refs: [CLAIM_ID],
    as_of: '2026-05-29T00:00:00.000Z',
    items: [{ label: 'Revenue', value_ref: FACT_ID }],
  })

  assert.deepEqual(refs.map((ref) => `${ref.ref.kind}:${ref.ref.id}`), [
    `source:${SOURCE_ID}`,
    `claim:${CLAIM_ID}`,
    `fact:${FACT_ID}`,
  ])
})

test('extractInspectableRefs extracts metrics_comparison cell facts and skips gaps', () => {
  const refs = extractInspectableRefs({
    id: 'mc-1',
    kind: 'metrics_comparison',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: 'metrics_comparison', id: 'mc-1' },
    source_refs: [SOURCE_ID],
    as_of: '2026-05-29T00:00:00.000Z',
    subjects: [{ kind: 'issuer', id: '99999999-9999-4999-8999-999999999991' }],
    metrics: ['Revenue', 'P/E'],
    // present cell + a null gap.
    cells: [[{ value_ref: FACT_ID }, null]],
  })

  assert.deepEqual(refs.map((ref) => `${ref.ref.kind}:${ref.ref.id}`), [
    `source:${SOURCE_ID}`,
    `fact:${FACT_ID}`,
  ])
})

test('extractInspectableRefs mirrors verifier refs for nested chart and research blocks', () => {
  const refs = extractInspectableRefs({
    id: 'section-1',
    kind: 'section',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: 'section', id: 'section-1' },
    source_refs: [],
    as_of: '2026-05-29T00:00:00.000Z',
    children: [
      {
        id: 'revenue-bars-1',
        kind: 'revenue_bars',
        snapshot_id: SNAPSHOT_ID,
        data_ref: { kind: 'revenue_bars', id: 'revenue-bars-1' },
        source_refs: [],
        as_of: '2026-05-29T00:00:00.000Z',
        bars: [{ label: 'Revenue', value_ref: FACT_ID, delta_ref: DELTA_FACT_ID }],
      },
      {
        id: 'news-1',
        kind: 'news_cluster',
        snapshot_id: SNAPSHOT_ID,
        data_ref: { kind: 'news_cluster', id: 'news-1' },
        source_refs: [],
        as_of: '2026-05-29T00:00:00.000Z',
        cluster_id: 'cluster-1',
        headline: 'Channel checks improved',
        claim_refs: [CLAIM_ID],
        document_refs: [DOCUMENT_ID],
      },
    ],
  })

  assert.deepEqual(refs.map((ref) => `${ref.ref.kind}:${ref.ref.id}`), [
    `fact:${FACT_ID}`,
    `fact:${DELTA_FACT_ID}`,
    `claim:${CLAIM_ID}`,
    `document:${DOCUMENT_ID}`,
  ])
})

test('extractInspectableRefs opens a rich text series chip as a series ref', () => {
  const SERIES_REF = '77777777-7777-4777-8777-777777777777'
  const refs = extractInspectableRefs({
    id: 'rt-1',
    kind: 'rich_text',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: 'rich_text', id: 'rt-1' },
    source_refs: [],
    as_of: '2026-05-29T00:00:00.000Z',
    segments: [
      { type: 'text', text: 'NVDA returned ' },
      { type: 'ref', ref_kind: 'series', ref_id: SERIES_REF, format: '6.6%' },
      { type: 'ref', ref_kind: 'listing', ref_id: FACT_ID, format: 'NVDA' },
    ],
  })

  assert.deepEqual(refs.map((ref) => `${ref.ref.kind}:${ref.ref.id}`), [`series:${SERIES_REF}`])
})

test('extractInspectableRefs reads each source of a linked or struck figure, as the seal does (#800)', () => {
  const refs = extractInspectableRefs({
    id: 'rt-figures',
    kind: 'rich_text',
    snapshot_id: SNAPSHOT_ID,
    data_ref: { kind: 'rich_text', id: 'rt-figures' },
    source_refs: [],
    as_of: '2026-05-29T00:00:00.000Z',
    segments: [
      { type: 'figure', text: '58%', sources: [{ ref_kind: 'result', ref_id: DELTA_FACT_ID }, { ref_kind: 'claim', ref_id: CLAIM_ID, numeral: 1 }], derivation: 'growth', operands: [] },
      { type: 'struck', text: '$72.1B', reason: 'the sources give $62.1B', sources: [{ ref_kind: 'fact', ref_id: FACT_ID }] },
    ],
  })
  assert.deepEqual(refs.map((ref) => `${ref.ref.kind}:${ref.ref.id}`), [`claim:${CLAIM_ID}`, `fact:${FACT_ID}`])
})
