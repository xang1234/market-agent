// Kept in sync with spec/finance_research_block_schema.json via schema-guard tests.
// Duplicated from services/resolver/src/subject-ref.ts to keep the watchlists
// service independently deployable; a shared package would be the right place
// once more than two services need it.
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
  id: string;
};

export function isSubjectKind(value: unknown): value is SubjectKind {
  return typeof value === "string" && (SUBJECT_KINDS as readonly string[]).includes(value);
}

export function isSubjectRef(value: unknown): value is SubjectRef {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === "string" && obj.id.length > 0 && isSubjectKind(obj.kind);
}
