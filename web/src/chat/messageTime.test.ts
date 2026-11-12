import assert from 'node:assert/strict'
import test from 'node:test'

import { messageTime } from './messageTime.ts'

const NOW = new Date('2026-11-12T09:00:00.000Z')

test('a message saved today shows its time, one saved earlier its date and time, with the full date in the tooltip', () => {
  assert.deepEqual(messageTime('2026-11-12T06:32:00.000Z', NOW, 'Asia/Singapore'), { short: '14:32', full: 'Thursday, November 12, 2026 at 2:32 PM' })
  assert.deepEqual(messageTime('2026-11-10T06:32:00.000Z', NOW, 'Asia/Singapore'), { short: 'Nov 10, 14:32', full: 'Tuesday, November 10, 2026 at 2:32 PM' })
})

test('today is the reader\'s day: the same instant is yesterday in New York', () => {
  assert.equal(messageTime('2026-11-12T03:00:00.000Z', NOW, 'Asia/Singapore')?.short, '11:00')
  assert.equal(messageTime('2026-11-12T03:00:00.000Z', NOW, 'America/New_York')?.short, 'Nov 11, 22:00')
})

test('a malformed time shows nothing', () => {
  assert.equal(messageTime('not a date', NOW), null)
})
