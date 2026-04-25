// Quote and bar retrieval is venue-sensitive (spec §6.2.1), so this service
// only accepts `listing` SubjectRefs — issuer or instrument identity isn't
// enough to resolve a market snapshot.
export type UUID = string;

export type ListingSubjectRef = {
  kind: "listing";
  id: UUID;
};

export function freezeListingRef(
  ref: ListingSubjectRef,
  label: string,
): ListingSubjectRef {
  if (ref?.kind !== "listing") {
    throw new Error(`${label}: listing must be a listing SubjectRef`);
  }
  return Object.freeze({ kind: ref.kind, id: ref.id });
}

export function assertListingRef(
  value: unknown,
  label: string,
): asserts value is ListingSubjectRef {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { kind?: unknown }).kind !== "listing" ||
    typeof (value as { id?: unknown }).id !== "string"
  ) {
    throw new Error(`${label}: must be a listing SubjectRef with string id`);
  }
}
