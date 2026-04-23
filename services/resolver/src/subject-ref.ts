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
