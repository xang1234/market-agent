import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSubjectRefShort } from './subjectRef.ts'

test('formatSubjectRefShort joins kind with the first 8 hex chars of the id', () => {
  assert.equal(
    formatSubjectRefShort({ kind: 'issuer', id: '11111111-2222-4333-9444-555555555555' }),
    'issuer:11111111',
  )
})

test('formatSubjectRefShort tolerates ids shorter than 8 chars', () => {
  assert.equal(formatSubjectRefShort({ kind: 'theme', id: 'abc' }), 'theme:abc')
})
