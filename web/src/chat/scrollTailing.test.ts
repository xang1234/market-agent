import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_AT_BOTTOM_THRESHOLD, isAtBottom } from './scrollTailing.ts'

test('isAtBottom returns true when scrolled to the exact bottom', () => {
  assert.equal(
    isAtBottom({ scrollTop: 9200, scrollHeight: 10000, clientHeight: 800 }),
    true,
  )
})

test('isAtBottom returns true within the default threshold', () => {
  assert.equal(
    isAtBottom({ scrollTop: 9170, scrollHeight: 10000, clientHeight: 800 }),
    true,
  )
})

test('isAtBottom returns false past the default threshold', () => {
  assert.equal(
    isAtBottom({ scrollTop: 9140, scrollHeight: 10000, clientHeight: 800 }),
    false,
  )
})

test('isAtBottom returns true when content does not overflow the viewport', () => {
  // Without this clamp the jump button would appear on a thread too short to
  // scroll, with nowhere to jump to.
  assert.equal(
    isAtBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 800 }),
    true,
  )
})

test('isAtBottom honors a caller-supplied threshold', () => {
  const pos = { scrollTop: 9120, scrollHeight: 10000, clientHeight: 800 }
  assert.equal(isAtBottom(pos, 100), true)
  assert.equal(isAtBottom(pos, 50), false)
})

test('DEFAULT_AT_BOTTOM_THRESHOLD is a positive pixel value', () => {
  assert.ok(DEFAULT_AT_BOTTOM_THRESHOLD > 0)
})
