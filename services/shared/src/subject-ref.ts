export type UUID = string;

export const COMMODITY_SUBJECT_KINDS = [
  "commodity",
  "benchmark",
  "contract",
  "curve",
  "region",
  "delivery_point",
  "asset",
  "producer",
  "route",
  "market_theme",
] as const;

export const RETAINED_WORKSPACE_SUBJECT_KINDS = [
  "portfolio",
  "screen",
] as const;

export const PUBLIC_SUBJECT_KINDS = [
  ...COMMODITY_SUBJECT_KINDS,
  ...RETAINED_WORKSPACE_SUBJECT_KINDS,
] as const;

// Kept during the fork migration so existing services/tests can keep running
// while new public contracts move to the commodities market-stack vocabulary.
export const LEGACY_FINANCE_SUBJECT_KINDS = [
  "issuer",
  "instrument",
  "listing",
  "theme",
  "macro_topic",
] as const;

export const SUBJECT_KINDS = [
  ...PUBLIC_SUBJECT_KINDS,
  ...LEGACY_FINANCE_SUBJECT_KINDS,
] as const;

export const DECISION_HORIZONS = ["1d", "1w", "1m", "3m"] as const;

export type CommoditySubjectKind = (typeof COMMODITY_SUBJECT_KINDS)[number];
export type RetainedWorkspaceSubjectKind = (typeof RETAINED_WORKSPACE_SUBJECT_KINDS)[number];
export type PublicSubjectKind = (typeof PUBLIC_SUBJECT_KINDS)[number];
export type LegacyFinanceSubjectKind = (typeof LEGACY_FINANCE_SUBJECT_KINDS)[number];
export type DecisionHorizon = (typeof DECISION_HORIZONS)[number];

/*
 * Legacy order before the commodities fork:
  "issuer",
  "instrument",
  "listing",
  "theme",
  "macro_topic",
  "portfolio",
  "screen",
 */

export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export type SubjectRef = {
  kind: SubjectKind;
  id: UUID;
};

export type PublicSubjectRef = {
  kind: PublicSubjectKind;
  id: UUID;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSubjectKind(value: unknown): value is SubjectKind {
  return typeof value === "string" && (SUBJECT_KINDS as ReadonlyArray<string>).includes(value);
}

export function isPublicSubjectKind(value: unknown): value is PublicSubjectKind {
  return typeof value === "string" && (PUBLIC_SUBJECT_KINDS as ReadonlyArray<string>).includes(value);
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

export function isPublicSubjectRef(value: unknown): value is PublicSubjectRef {
  if (value === null || typeof value !== "object") return false;
  const ref = value as { kind?: unknown; id?: unknown };
  return isPublicSubjectKind(ref.kind) && isUuid(ref.id);
}

export function assertPublicSubjectRef(value: unknown, label: string): asserts value is PublicSubjectRef {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object with kind and id`);
  }
  const ref = value as { kind?: unknown; id?: unknown };
  if (!isPublicSubjectKind(ref.kind)) {
    throw new Error(`${label}.kind: must be one of ${PUBLIC_SUBJECT_KINDS.join(", ")}`);
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
