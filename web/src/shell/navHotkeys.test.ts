import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NAV_HOTKEYS, navPathForKey } from './navHotkeys.ts'

test('single letters map to workspace paths', () => {
  assert.equal(navPathForKey('h'), '/home')
  assert.equal(navPathForKey('c'), '/chat')
  assert.equal(navPathForKey('s'), '/screener')
  assert.equal(navPathForKey('a'), '/agents')
  assert.equal(navPathForKey('g'), '/analyst-grids')
  assert.equal(navPathForKey('x'), null)
})

test('hotkey list carries single-letter keys and absolute paths for the sidebar chips', () => {
  assert.ok(NAV_HOTKEYS.length >= 5)
  assert.ok(NAV_HOTKEYS.every((item) => item.key.length === 1 && item.to.startsWith('/')))
})
