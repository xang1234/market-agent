// Statement and metric reads anchor on issuer identity (spec §6.3.1):
// listings are venue-specific, but reported financial statements belong to
// the reporting entity. Accepting only `issuer` SubjectRefs here enforces
// that boundary.
export type UUID = string;

export type IssuerSubjectRef = {
  kind: "issuer";
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
    (value as { kind?: unknown }).kind !== "issuer" ||
    typeof (value as { id?: unknown }).id !== "string"
  ) {
    throw new Error(`${label}: must be an issuer SubjectRef with string id`);
  }
}
