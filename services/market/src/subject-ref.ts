// Quote and bar retrieval is venue-sensitive (spec §6.2.1), so this service
// only accepts `listing` SubjectRefs — issuer or instrument identity isn't
// enough to resolve a market snapshot.
export type UUID = string;

export type ListingSubjectRef = {
  kind: "listing";
  id: UUID;
};
