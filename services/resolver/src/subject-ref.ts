export type UUID = string;

// Authoritative source for the SubjectKind enum in this package. The type
// union is derived from this tuple so adding a kind is a single edit and
// TypeScript can still discriminate on literal values. A drift test
// compares this list against spec/finance_research_block_schema.json.
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
