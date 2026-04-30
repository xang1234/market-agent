import assert from 'node:assert/strict'
import test from 'node:test'

import { blockPropsAreEqual } from './blockMemoization.ts'
import { richTextFixture } from './fixtures.ts'

test('blockPropsAreEqual returns true when block references are identical', () => {
  assert.equal(
    blockPropsAreEqual({ block: richTextFixture }, { block: richTextFixture }),
    true,
  )
})

test('blockPropsAreEqual returns false when references differ even with equal contents', () => {
  // Two structurally-equal blocks with different references must re-render.
  // The contract relies on the snapshot store keeping stable refs for
  // unchanged blocks; a caller that re-clones every block per render
  // deserves the re-render cost.
  const a = { ...richTextFixture }
  const b = { ...richTextFixture }
  assert.equal(blockPropsAreEqual({ block: a }, { block: b }), false)
})

test('blockPropsAreEqual returns false when block content changes (new reference)', () => {
  const updated = { ...richTextFixture, segments: [{ type: 'text' as const, text: 'changed' }] }
  assert.equal(blockPropsAreEqual({ block: richTextFixture }, { block: updated }), false)
})
