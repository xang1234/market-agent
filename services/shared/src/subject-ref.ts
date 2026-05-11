export type UUID = string;

export const SUBJECT_KINDS = [
  "issuer",
  "instrument",
  "listing",
  "theme",
  "macro_topic",
  "portfolio",
  "screen",
] as const;

export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export type SubjectRef = {
  kind: SubjectKind;
  id: UUID;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSubjectKind(value: unknown): value is SubjectKind {
  return typeof value === "string" && (SUBJECT_KINDS as ReadonlyArray<string>).includes(value);
}

export function isUuid(value: unknown): value is UUID {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isSubjectRef(value: unknown): value is SubjectRef {
  if (value === null || typeof value !== "object") return false;
  const ref = value as { kind?: unknown; id?: unknown };
  return isSubjectKind(ref.kind) && isUuid(ref.id);
}

export function assertSubjectRef(value: unknown, label: string): asserts value is SubjectRef {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object with kind and id`);
  }
  const ref = value as { kind?: unknown; id?: unknown };
  if (!isSubjectKind(ref.kind)) {
    throw new Error(`${label}.kind: must be one of ${SUBJECT_KINDS.join(", ")}`);
  }
  if (!isUuid(ref.id)) {
    throw new Error(`${label}.id: must be a UUID v4`);
  }
}

export function formatSubjectRef(subjectRef: SubjectRef): string {
  return `${subjectRef.kind}:${subjectRef.id}`;
}

export function parseSubjectRefString(value: string): SubjectRef | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  const candidate = { kind, id };
  return isSubjectRef(candidate) ? candidate : null;
}
