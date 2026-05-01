export type UUID = string;

// Kept in sync with spec/finance_research_block_schema.json via subject-ref.test.ts.
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

// Canonical SubjectRef validator. Lives here because resolver/subject-ref.ts
// already owns the SUBJECT_KINDS vocabulary and is imported by every
// downstream service that touches subjects (themes, watchlists, screener,
// chat). Inlines its checks rather than depending on a per-service
// validators.ts to keep this module dependency-free.
export function assertSubjectRef(value: unknown, label: string): asserts value is SubjectRef {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object with kind and id`);
  }
  const ref = value as Partial<SubjectRef>;
  if (typeof ref.kind !== "string" || !(SUBJECT_KINDS as ReadonlyArray<string>).includes(ref.kind)) {
    throw new Error(`${label}.kind: must be one of ${SUBJECT_KINDS.join(", ")}`);
  }
  if (typeof ref.id !== "string" || ref.id.length === 0) {
    throw new Error(`${label}.id: must be a non-empty string`);
  }
}
