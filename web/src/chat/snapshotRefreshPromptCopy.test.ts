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

test('snapshotRefreshPromptCopy distinguishes peer_set from freshness so users know what to expect', () => {
  // The two reasons demand different mental models from the user:
  // peer_set means "you changed the comparison set", freshness means "the
  // saved snapshot is too old". Same copy would defeat the explicit prompt.
  const peerSet = snapshotRefreshPromptCopy('peer_set')
  const freshness = snapshotRefreshPromptCopy('freshness')
  assert.notEqual(peerSet, freshness)
})
