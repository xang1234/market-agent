// Screener result rows span all three market-identity kinds (spec §6.7.1):
// - issuer    — the legal entity (e.g. Apple Inc.)
// - instrument— a security issued by an issuer (e.g. AAPL common stock)
// - listing   — a venue-specific trading line (e.g. AAPL on XNAS)
//
// Market service rows are listing-only; fundamentals are issuer-anchored.
// The screener returns whichever kind matches the query semantics, so the
// SubjectRef union here must accept all three. The {kind, id} shape is
// intentionally identical to the upstream services' SubjectRef shapes so
// row.subject_ref can be handed off to the symbol-entry flow without
// adapter code (cw0.6.3 already parses `kind:uuid` URL params).

import { assertOneOf, assertUuid } from "./validators.ts";

export type UUID = string;

export type ScreenerSubjectKind = "issuer" | "instrument" | "listing";

export const SCREENER_SUBJECT_KINDS: ReadonlyArray<ScreenerSubjectKind> = [
  "issuer",
  "instrument",
  "listing",
];

export type ScreenerSubjectRef = {
  kind: ScreenerSubjectKind;
  id: UUID;
};

export function freezeSubjectRef(
  ref: ScreenerSubjectRef,
  label: string,
): ScreenerSubjectRef {
  assertSubjectRef(ref, label);
  return Object.freeze({ kind: ref.kind, id: ref.id });
}

export function assertSubjectRef(
  value: unknown,
  label: string,
): asserts value is ScreenerSubjectRef {
  if (!value || typeof value !== "object") {
    throw new Error(`${label}: must be a SubjectRef object`);
  }
  const ref = value as { kind?: unknown; id?: unknown };
  assertOneOf(ref.kind, SCREENER_SUBJECT_KINDS, `${label}.kind`);
  assertUuid(ref.id, `${label}.id`);
}
