// Local re-declaration kept in sync with services/resolver/src/subject-ref.ts.
// The market service deliberately depends only on `listing` SubjectRefs — quote
// and bar retrieval are venue-sensitive (per spec §6.2.1), so issuer-level or
// instrument-level identity is not enough to resolve a market snapshot.
export type UUID = string;

export type ListingSubjectRef = {
  kind: "listing";
  id: UUID;
};
