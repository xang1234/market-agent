import assert from 'node:assert/strict'
import test from 'node:test'
import type { SubjectRef, WatchlistMember } from './membership.ts'
import { isSubjectWatchlisted } from './subjectMembership.ts'

const APPLE_LISTING: SubjectRef = {
  kind: 'listing',
  id: '11111111-1111-4111-a111-111111111111',
}
const MICROSOFT_LISTING: SubjectRef = {
  kind: 'listing',
  id: '22222222-2222-4222-a222-222222222222',
}

const member = (ref: SubjectRef): WatchlistMember => ({
  subject_ref: ref,
  created_at: '2026-04-27T00:00:00Z',
})

test('isSubjectWatchlisted true when the exact ref is in the list', () => {
  assert.equal(isSubjectWatchlisted(APPLE_LISTING, [member(APPLE_LISTING)]), true)
})

test('isSubjectWatchlisted false when the list contains a different subject', () => {
  assert.equal(isSubjectWatchlisted(APPLE_LISTING, [member(MICROSOFT_LISTING)]), false)
})

test('isSubjectWatchlisted false on an empty list', () => {
  assert.equal(isSubjectWatchlisted(APPLE_LISTING, []), false)
})

test('isSubjectWatchlisted requires both kind and id to match (cross-kind id collisions are not members)', () => {
  // Pins the contract that subject identity is (kind, id), not id alone.
  // A theme with the same UUID as a listing must not register.
  const themeWithSameId: SubjectRef = { kind: 'theme', id: APPLE_LISTING.id }
  assert.equal(isSubjectWatchlisted(APPLE_LISTING, [member(themeWithSameId)]), false)
})
