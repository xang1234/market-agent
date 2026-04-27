// Pure derivation for the subject-detail "watchlisted / held" badges
// (cw0.10.2). The contract is that both states are reported separately —
// a subject that is both watchlisted and held shows both badges; the
// derivation never collapses one into the other.

import type { SubjectRef, WatchlistMember } from './membership'

export type SubjectMembershipBadges = {
  watchlisted: boolean
  held: boolean
}

export function subjectMembershipBadges(args: {
  subjectRef: SubjectRef
  watchlistMembers: ReadonlyArray<WatchlistMember>
  held: boolean
}): SubjectMembershipBadges {
  return {
    watchlisted: args.watchlistMembers.some(
      (m) => m.subject_ref.kind === args.subjectRef.kind && m.subject_ref.id === args.subjectRef.id,
    ),
    held: args.held,
  }
}
