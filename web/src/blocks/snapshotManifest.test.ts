import assert from 'node:assert/strict'
import test from 'node:test'
import { createSnapshotManifest, resolveRefSegment } from './snapshotManifest.ts'
import type { RefSegment } from './types.ts'

const FACT_ID = '22222222-2222-4222-9222-222222222222'
const CLAIM_ID = '33333333-3333-4333-9333-333333333333'
const EVENT_ID = '44444444-4444-4444-9444-444444444444'

test('resolveRefSegment returns the formatted value when the fact is present in the manifest', () => {
  const manifest = createSnapshotManifest({ fact: { [FACT_ID]: '$1,234.56' } })
  const segment: RefSegment = { type: 'ref', ref_kind: 'fact', ref_id: FACT_ID }
  const result = resolveRefSegment(manifest, segment)
  assert.deepEqual(result, { state: 'resolved', value: '$1,234.56' })
})

test('resolveRefSegment looks up claims and events in their own tables, not the facts table', () => {
  const manifest = createSnapshotManifest({
    claim: { [CLAIM_ID]: 'Apple services margin improving' },
    event: { [EVENT_ID]: 'FY24 10-K filed' },
  })
  const claimResult = resolveRefSegment(manifest, { type: 'ref', ref_kind: 'claim', ref_id: CLAIM_ID })
  const eventResult = resolveRefSegment(manifest, { type: 'ref', ref_kind: 'event', ref_id: EVENT_ID })
  assert.deepEqual(claimResult, { state: 'resolved', value: 'Apple services margin improving' })
  assert.deepEqual(eventResult, { state: 'resolved', value: 'FY24 10-K filed' })
})

test('resolveRefSegment returns unresolved when the ref id is missing from the manifest', () => {
  const manifest = createSnapshotManifest({ fact: { [FACT_ID]: '$1,234.56' } })
  const segment: RefSegment = { type: 'ref', ref_kind: 'fact', ref_id: 'missing-id' }
  const result = resolveRefSegment(manifest, segment)
  assert.equal(result.state, 'unresolved')
  if (result.state === 'unresolved') {
    assert.equal(result.segment, segment, 'unresolved result carries the originating segment for error rendering')
  }
})

test('resolveRefSegment does not cross-resolve a fact id from the claims table', () => {
  const manifest = createSnapshotManifest({ claim: { [FACT_ID]: 'wrong table' } })
  const segment: RefSegment = { type: 'ref', ref_kind: 'fact', ref_id: FACT_ID }
  const result = resolveRefSegment(manifest, segment)
  assert.equal(result.state, 'unresolved')
})

test('an empty manifest resolves nothing — every ref returns unresolved', () => {
  const empty = createSnapshotManifest()
  for (const ref_kind of ['fact', 'claim', 'event'] as const) {
    const result = resolveRefSegment(empty, { type: 'ref', ref_kind, ref_id: 'any-id' })
    assert.equal(result.state, 'unresolved', `expected ${ref_kind} ref to be unresolved against an empty manifest`)
  }
})

test('createSnapshotManifest with no arguments produces an empty manifest with all three tables', () => {
  const manifest = createSnapshotManifest()
  assert.deepEqual(manifest, { fact: {}, claim: {}, event: {} })
})
