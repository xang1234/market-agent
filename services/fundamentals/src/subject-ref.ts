// Statement and metric reads anchor on issuer identity (spec §6.3.1):
// listings are venue-specific, but reported financial statements belong to
// the reporting entity. Accepting only `issuer` SubjectRefs at the statement
// boundary enforces that. `ListingSubjectRef` is also defined here so the
// profile envelope can cite the issuer's exchanges by canonical listing
// identity (spec §4.1.1) without duplicating the type per consumer.
import { assertUuid } from "./validators.ts";

export type UUID = string;

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
  if (
    !value ||
    typeof value !== "object" ||
    (value as { kind?: unknown }).kind !== "issuer"
  ) {
    throw new Error(`${label}: must be an issuer SubjectRef with string id`);
  }
  assertUuid((value as { id?: unknown }).id, `${label}.id`);
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
  if (
    !value ||
    typeof value !== "object" ||
    (value as { kind?: unknown }).kind !== "listing"
  ) {
    throw new Error(`${label}: must be a listing SubjectRef with string id`);
  }
  assertUuid((value as { id?: unknown }).id, `${label}.id`);
}
