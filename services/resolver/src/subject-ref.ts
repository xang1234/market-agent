export type UUID = string;

export type SubjectKind =
  | "issuer"
  | "instrument"
  | "listing"
  | "theme"
  | "macro_topic"
  | "portfolio"
  | "screen";

export type SubjectRef = {
  kind: SubjectKind;
  id: UUID;
};

export const SUBJECT_KINDS: readonly SubjectKind[] = [
  "issuer",
  "instrument",
  "listing",
  "theme",
  "macro_topic",
  "portfolio",
  "screen",
];
