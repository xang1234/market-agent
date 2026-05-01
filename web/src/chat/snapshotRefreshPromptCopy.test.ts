import assert from 'node:assert/strict'
import test from 'node:test'

import { SNAPSHOT_REFRESH_REQUIRED_REASONS } from './blockSnapshotTransform.ts'
import { snapshotRefreshPromptCopy } from './snapshotRefreshPromptCopy.ts'

test('snapshotRefreshPromptCopy returns a non-empty user-facing string for every reason', () => {
  // If a backend reason is ever added without a copy entry, the lookup
  // returns undefined and the prompt would render blank. Guard against it.
  for (const reason of SNAPSHOT_REFRESH_REQUIRED_REASONS) {
    const copy = snapshotRefreshPromptCopy(reason)
    assert.equal(typeof copy, 'string', `${reason}: copy must be a string`)
    assert.ok(copy.length > 0, `${reason}: copy must be non-empty`)
  }
})

test('snapshotRefreshPromptCopy returns a distinct string for every reason so users can tell what changed', () => {
  // Each reason demands a different mental model from the user (peer_set =
  // "you changed the comparison set", freshness = "the saved snapshot is
  // too old", etc.). A single shared copy across reasons would defeat the
  // explicit prompt that invariant I8 requires. Pin all-pairs distinctness
  // to catch any future copy-paste collapse.
  const copies = SNAPSHOT_REFRESH_REQUIRED_REASONS.map(snapshotRefreshPromptCopy)
  assert.equal(
    new Set(copies).size,
    SNAPSHOT_REFRESH_REQUIRED_REASONS.length,
    `expected one distinct copy per reason; got: ${JSON.stringify(copies)}`,
  )
})
