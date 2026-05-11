// Statement boundary takes only IssuerSubjectRef (spec §6.3.1). ListingSubjectRef
// lives here so the profile envelope can cite exchanges by canonical identity.
import { assertSubjectRef as assertCanonicalSubjectRef, type UUID } from "../../shared/src/subject-ref.ts";

export type IssuerSubjectRef = {
  kind: "issuer";
  id: UUID;
};

export type ListingSubjectRef = {
  kind: "listing";
  id: UUID;
};

export function freezeIssuerRef(
  ref: IssuerSubjectRef,
  label: string,
): IssuerSubjectRef {
  assertIssuerRef(ref, label);
  return Object.freeze({ kind: ref.kind, id: ref.id });
}

export function assertIssuerRef(
  value: unknown,
  label: string,
): asserts value is IssuerSubjectRef {
  assertCanonicalSubjectRef(value, label);
  if ((value as { kind?: unknown }).kind !== "issuer") {
    throw new Error(`${label}: must be an issuer SubjectRef`);
  }
}

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
