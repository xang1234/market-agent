// Pure derivation for the subject-detail "watchlisted / held" badges. The
// two states are reported separately — a subject that is both watchlisted
// AND held shows two distinct badges; this function never collapses one
// into the other.

import type { SubjectRef, WatchlistMember } from './membership'

export type SubjectMembershipFlags = {
  watchlisted: boolean
  held: boolean
}

export function isSubjectWatchlisted(
  subjectRef: SubjectRef,
  members: ReadonlyArray<WatchlistMember>,
): boolean {
  // Subject identity is (kind, id), not id alone — a theme with the same
  // UUID as a listing must not register as the listing being watchlisted.
  return members.some(
    (m) => m.subject_ref.kind === subjectRef.kind && m.subject_ref.id === subjectRef.id,
  )
}
