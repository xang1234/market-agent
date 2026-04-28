import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isRefSegment,
  isTextSegment,
  refSegmentPlaceholder,
} from './richText.ts'
import type { RefSegment, TextSegment } from './types.ts'

test('isTextSegment / isRefSegment narrow on the discriminator', () => {
  const text: TextSegment = { type: 'text', text: 'hello' }
  const ref: RefSegment = { type: 'ref', ref_kind: 'fact', ref_id: 'a' }
  assert.equal(isTextSegment(text), true)
  assert.equal(isTextSegment(ref), false)
  assert.equal(isRefSegment(text), false)
  assert.equal(isRefSegment(ref), true)
})

test('refSegmentPlaceholder prefers `format` when present', () => {
  const ref: RefSegment = {
    type: 'ref',
    ref_kind: 'fact',
    ref_id: '11111111-1111-4111-9111-111111111111',
    format: '$85.8B',
  }
  assert.equal(refSegmentPlaceholder(ref), '$85.8B')
})

test('refSegmentPlaceholder falls back to a short kind+id label when format is missing', () => {
  const ref: RefSegment = {
    type: 'ref',
    ref_kind: 'claim',
    ref_id: '12345678-1234-4abc-9def-1234567890ab',
  }
  assert.equal(refSegmentPlaceholder(ref), '[claim:12345678]')
})

test('refSegmentPlaceholder ignores empty `format` and falls back to the id label', () => {
  const ref: RefSegment = {
    type: 'ref',
    ref_kind: 'event',
    ref_id: '00000000-0000-4000-9000-000000000abc',
    format: '',
  }
  assert.equal(refSegmentPlaceholder(ref), '[event:00000000]')
})
