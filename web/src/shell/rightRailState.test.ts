import test from 'node:test'
import assert from 'node:assert/strict'
import { getRightRailState } from './rightRailState.ts'

test('empty right rail keeps the slot mounted in empty mode', () => {
  assert.deepEqual(getRightRailState(null), { mode: 'empty' })
})

test('boolean right rail content is normalized to empty mode', () => {
  assert.deepEqual(getRightRailState(false), { mode: 'empty' })
  assert.deepEqual(getRightRailState(true), { mode: 'empty' })
})

test('non-empty right rail exposes content mode', () => {
  assert.deepEqual(getRightRailState('Activity stream'), {
    mode: 'content',
    content: 'Activity stream',
  })
})
