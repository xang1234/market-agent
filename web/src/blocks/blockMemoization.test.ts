import assert from 'node:assert/strict'
import test from 'node:test'

import { blockPropsAreEqual } from './blockMemoization.ts'
import type { Block, RichTextBlock } from './types.ts'

function makeRichTextBlock(id: string, text: string): RichTextBlock {
  return {
    id,
    kind: 'rich_text',
    snapshot_id: 'snap-1',
    data_ref: { kind: 'rich_text', id },
    source_refs: [],
    as_of: '2026-01-01T00:00:00Z',
    segments: [{ type: 'text', text }],
  }
}

test('blockPropsAreEqual returns true when block references are identical', () => {
  const block: Block = makeRichTextBlock('b1', 'hello')
  assert.equal(blockPropsAreEqual({ block }, { block }), true)
})

test('blockPropsAreEqual returns false when references differ even with equal contents', () => {
  // Two blocks with structurally-equal contents but different references must
  // re-render. The contract relies on the snapshot store maintaining stable
  // references for unchanged blocks; a caller that breaks this invariant
  // (e.g., re-clones every block per render) deserves the re-render cost.
  const a: Block = makeRichTextBlock('b1', 'hello')
  const b: Block = makeRichTextBlock('b1', 'hello')
  assert.equal(blockPropsAreEqual({ block: a }, { block: b }), false)
})

test('blockPropsAreEqual returns false when block content changes (new reference)', () => {
  const original: Block = makeRichTextBlock('b1', 'hello')
  const updated: Block = makeRichTextBlock('b1', 'hello world')
  assert.equal(blockPropsAreEqual({ block: original }, { block: updated }), false)
})
