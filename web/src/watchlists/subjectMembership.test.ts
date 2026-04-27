import assert from 'node:assert/strict'
import test from 'node:test'
import type { SubjectRef, WatchlistMember } from './membership.ts'
import { subjectMembershipBadges } from './subjectMembership.ts'

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

test('badges reports both flags independently when subject is watchlisted AND held', () => {
  const badges = subjectMembershipBadges({
    subjectRef: APPLE_LISTING,
    watchlistMembers: [member(APPLE_LISTING)],
    held: true,
  })
  assert.deepStrictEqual(badges, { watchlisted: true, held: true })
})

test('badges does NOT collapse the two states — held alone keeps watchlisted false', () => {
  const badges = subjectMembershipBadges({
    subjectRef: APPLE_LISTING,
    watchlistMembers: [member(MICROSOFT_LISTING)],
    held: true,
  })
  assert.deepStrictEqual(badges, { watchlisted: false, held: true })
})

test('badges reports watchlisted alone when not held', () => {
  const badges = subjectMembershipBadges({
    subjectRef: APPLE_LISTING,
    watchlistMembers: [member(APPLE_LISTING)],
    held: false,
  })
  assert.deepStrictEqual(badges, { watchlisted: true, held: false })
})

test('badges reports neither when the subject is unknown to both surfaces', () => {
  const badges = subjectMembershipBadges({
    subjectRef: APPLE_LISTING,
    watchlistMembers: [member(MICROSOFT_LISTING)],
    held: false,
  })
  assert.deepStrictEqual(badges, { watchlisted: false, held: false })
})

test('watchlist match requires both kind and id to match (cross-kind id collisions are not members)', () => {
  // A theme with the same UUID as a listing must not register as the
  // listing being watchlisted. Subject identity is (kind, id), not id alone.
  const themeWithSameId: SubjectRef = { kind: 'theme', id: APPLE_LISTING.id }
  const badges = subjectMembershipBadges({
    subjectRef: APPLE_LISTING,
    watchlistMembers: [member(themeWithSameId)],
    held: false,
  })
  assert.deepStrictEqual(badges, { watchlisted: false, held: false })
})
