// Quote and bar retrieval is venue-sensitive (spec §6.2.1), so this service
// only accepts `listing` SubjectRefs — issuer or instrument identity isn't
// enough to resolve a market snapshot.
import { assertSubjectRef as assertCanonicalSubjectRef, type UUID } from "../../shared/src/subject-ref.ts";

export type ListingSubjectRef = {
  kind: "listing";
  id: UUID;
};

export function freezeListingRef(
  ref: ListingSubjectRef,
  label: string,
): ListingSubjectRef {
  assertListingRef(ref, label);
  return Object.freeze({ kind: ref.kind, id: ref.id });
}

export function assertListingRef(
  value: unknown,
  label: string,
): asserts value is ListingSubjectRef {
  assertCanonicalSubjectRef(value, label);
  if ((value as { kind?: unknown }).kind !== "listing") {
    throw new Error(`${label}: must be a listing SubjectRef`);
  }
}
