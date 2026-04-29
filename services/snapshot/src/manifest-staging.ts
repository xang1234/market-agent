import { createHash } from "node:crypto";

export type JsonObject = { [key: string]: JsonValue };

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;

export const STAGED_SNAPSHOT_MANIFEST: unique symbol = Symbol("snapshot.stagedManifest");

export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

export const SNAPSHOT_SUBJECT_KINDS = [
  "issuer",
  "instrument",
  "listing",
  "theme",
  "macro_topic",
  "portfolio",
  "screen",
] as const;

export type SnapshotSubjectKind = (typeof SNAPSHOT_SUBJECT_KINDS)[number];

export type SnapshotSubjectRef = {
  kind: SnapshotSubjectKind;
  id: string;
};

export const SNAPSHOT_BASES = [
  "unadjusted",
  "split_adjusted",
  "split_and_div_adjusted",
  "reported",
  "restated",
] as const;

export type SnapshotBasis = (typeof SNAPSHOT_BASES)[number];

export const SNAPSHOT_NORMALIZATIONS = [
  "raw",
  "pct_return",
  "index_100",
  "currency_normalized",
] as const;

export type SnapshotNormalization = (typeof SNAPSHOT_NORMALIZATIONS)[number];

export type SnapshotManifestDraft = {
  readonly [STAGED_SNAPSHOT_MANIFEST]?: true;
  subject_refs: ReadonlyArray<SnapshotSubjectRef>;
  fact_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  event_refs: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
  series_specs: ReadonlyArray<JsonValue>;
  source_ids: ReadonlyArray<string>;
  tool_call_ids: ReadonlyArray<string>;
  tool_call_result_hashes: ReadonlyArray<ToolCallResultHash>;
  as_of: string;
  basis: SnapshotBasis;
  normalization: SnapshotNormalization;
  coverage_start: string | null;
  allowed_transforms: JsonValue;
  model_version: string | null;
  parent_snapshot: string | null;
};

export type ToolCallResultHash = {
  tool_call_id: string;
  result_hash: string;
};

export type ToolCallManifestContribution = {
  tool_call_id: string;
  result?: JsonValue;
  subject_refs?: ReadonlyArray<SnapshotSubjectRef>;
  fact_refs?: ReadonlyArray<string>;
  claim_refs?: ReadonlyArray<string>;
  event_refs?: ReadonlyArray<string>;
  document_refs?: ReadonlyArray<string>;
  series_specs?: ReadonlyArray<JsonValue>;
  source_ids?: ReadonlyArray<string>;
};

export type StageSnapshotManifestInput = {
  subject_refs: ReadonlyArray<SnapshotSubjectRef>;
  as_of: string;
  basis: SnapshotBasis;
  normalization: SnapshotNormalization;
  coverage_start?: string | null;
  allowed_transforms?: JsonValue;
  model_version?: string | null;
  parent_snapshot?: string | null;
  tool_calls: ReadonlyArray<ToolCallManifestContribution>;
};

export type ToolCallLogAudit = {
  ok: boolean;
  missing_tool_call_ids: ReadonlyArray<string>;
  mismatched_tool_call_ids: ReadonlyArray<string>;
  extra_tool_call_ids: ReadonlyArray<string>;
  duplicate_tool_call_ids: ReadonlyArray<string>;
  missing_hash_tool_call_ids: ReadonlyArray<string>;
  missing_provenance: boolean;
};

export type ToolCallLogAuditOptions = {
  thread_id?: string | null;
  agent_id?: string | null;
  allowed_statuses?: ReadonlyArray<string>;
};

export const DEFAULT_TOOL_CALL_AUDIT_STATUSES = Object.freeze(["ok"]);

const ISO_8601_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;
const UUID_V4 =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const SHA256_HASH = /^sha256:[0-9a-f]{64}$/;

export function stageSnapshotManifest(
  input: StageSnapshotManifestInput,
): SnapshotManifestDraft {
  if (input === null || typeof input !== "object") {
    throw new Error("stageSnapshotManifest: input must be an object");
  }

  const subject_refs = new FirstSeenSet<SnapshotSubjectRef>(
    (subjectRef) => `${subjectRef.kind}:${subjectRef.id}`,
    (subjectRef, label) => freezeSubjectRef(subjectRef, label),
  );
  const fact_refs = new FirstSeenSet<string>((value) => value, assertUuidRef);
  const claim_refs = new FirstSeenSet<string>((value) => value, assertUuidRef);
  const event_refs = new FirstSeenSet<string>((value) => value, assertUuidRef);
  const document_refs = new FirstSeenSet<string>((value) => value, assertUuidRef);
  const source_ids = new FirstSeenSet<string>((value) => value, assertUuidRef);
  const tool_call_ids = new FirstSeenSet<string>((value) => value, assertUuidRef);
  const toolCallResultHashes = new Map<string, string>();
  const series_specs = new FirstSeenSet<JsonValue>(
    stableJson,
    (value, label) => deepFreezeJson(cloneJsonValue(value, label)),
  );

  assertArray(input.subject_refs, "stageSnapshotManifest.subject_refs");
  input.subject_refs.forEach((subjectRef, index) => {
    subject_refs.add(subjectRef, `stageSnapshotManifest.subject_refs[${index}]`);
  });

  assertArray(input.tool_calls, "stageSnapshotManifest.tool_calls");
  input.tool_calls.forEach((toolCall, index) => {
    if (toolCall === null || typeof toolCall !== "object") {
      throw new Error(`stageSnapshotManifest.tool_calls[${index}]: must be an object`);
    }

    const toolCallId = assertUuidRef(
      toolCall.tool_call_id,
      `stageSnapshotManifest.tool_calls[${index}].tool_call_id`,
    );
    tool_call_ids.add(toolCallId, `stageSnapshotManifest.tool_calls[${index}].tool_call_id`);
    const contributionPayload = manifestContributionPayload(toolCall, index);
    const resultHash = toolCallResultHash(toolCall, index, contributionPayload);
    const existingHash = toolCallResultHashes.get(toolCallId);
    if (existingHash !== undefined && existingHash !== resultHash) {
      throw new Error(`stageSnapshotManifest.tool_calls[${index}].tool_call_id: duplicate contribution hash mismatch`);
    }
    if (existingHash === undefined) {
      toolCallResultHashes.set(toolCallId, resultHash);
    }
    addSubjectRefs(
      subject_refs,
      toolCall.subject_refs,
      `stageSnapshotManifest.tool_calls[${index}].subject_refs`,
    );
    addUuidRefs(
      fact_refs,
      toolCall.fact_refs,
      `stageSnapshotManifest.tool_calls[${index}].fact_refs`,
    );
    addUuidRefs(
      claim_refs,
      toolCall.claim_refs,
      `stageSnapshotManifest.tool_calls[${index}].claim_refs`,
    );
    addUuidRefs(
      event_refs,
      toolCall.event_refs,
      `stageSnapshotManifest.tool_calls[${index}].event_refs`,
    );
    addUuidRefs(
      document_refs,
      toolCall.document_refs,
      `stageSnapshotManifest.tool_calls[${index}].document_refs`,
    );
    addUuidRefs(
      source_ids,
      toolCall.source_ids,
      `stageSnapshotManifest.tool_calls[${index}].source_ids`,
    );
    addJsonValues(
      series_specs,
      toolCall.series_specs,
      `stageSnapshotManifest.tool_calls[${index}].series_specs`,
    );
  });

  assertNonEmptyArray(subject_refs.values(), "stageSnapshotManifest.subject_refs");
  assertOneOf(input.basis, SNAPSHOT_BASES, "stageSnapshotManifest.basis");
  assertOneOf(
    input.normalization,
    SNAPSHOT_NORMALIZATIONS,
    "stageSnapshotManifest.normalization",
  );

  return Object.freeze({
    [STAGED_SNAPSHOT_MANIFEST]: true,
    subject_refs: Object.freeze(subject_refs.values()),
    fact_refs: Object.freeze(fact_refs.values()),
    claim_refs: Object.freeze(claim_refs.values()),
    event_refs: Object.freeze(event_refs.values()),
    document_refs: Object.freeze(document_refs.values()),
    series_specs: Object.freeze(series_specs.values()),
    source_ids: Object.freeze(source_ids.values()),
    tool_call_ids: Object.freeze(tool_call_ids.values()),
    tool_call_result_hashes: Object.freeze(
      [...toolCallResultHashes.entries()].map(([tool_call_id, result_hash]) =>
        Object.freeze({ tool_call_id, result_hash }),
      ),
    ),
    as_of: canonicalTimestamp(input.as_of, "stageSnapshotManifest.as_of"),
    basis: input.basis,
    normalization: input.normalization,
    coverage_start:
      input.coverage_start == null
        ? null
        : canonicalTimestamp(
            input.coverage_start,
            "stageSnapshotManifest.coverage_start",
          ),
    allowed_transforms: deepFreezeJson(
      cloneJsonValue(input.allowed_transforms ?? {}, "stageSnapshotManifest.allowed_transforms"),
    ),
    model_version: optionalNonEmptyString(
      input.model_version,
      "stageSnapshotManifest.model_version",
    ),
    parent_snapshot: optionalUuid(
      input.parent_snapshot,
      "stageSnapshotManifest.parent_snapshot",
    ),
  });
}

export async function auditManifestToolCallLog(
  db: QueryExecutor,
  manifest: Pick<SnapshotManifestDraft, "tool_call_ids" | "tool_call_result_hashes"> &
    Partial<
      Pick<
        SnapshotManifestDraft,
        "fact_refs" | "claim_refs" | "event_refs" | "document_refs" | "series_specs" | "source_ids"
      >
    >,
  options: ToolCallLogAuditOptions = {},
): Promise<ToolCallLogAudit> {
  assertArray(
    manifest.tool_call_ids,
    "auditManifestToolCallLog.tool_call_ids",
  );
  const toolCallIds = manifest.tool_call_ids.map((toolCallId, index) =>
    assertUuidRef(toolCallId, `auditManifestToolCallLog.tool_call_ids[${index}]`),
  );
  const uniqueToolCallIds = firstSeen(toolCallIds);
  const duplicateToolCallIds = duplicateValues(toolCallIds);
  const toolCallIdSet = new Set(uniqueToolCallIds);
  assertArray(
    manifest.tool_call_result_hashes,
    "auditManifestToolCallLog.tool_call_result_hashes",
  );
  const expectedHashes = new Map<string, string>();
  const hashToolCallIds: string[] = [];
  manifest.tool_call_result_hashes.forEach((item, index) => {
    if (item === null || typeof item !== "object") {
      throw new Error(`auditManifestToolCallLog.tool_call_result_hashes[${index}]: must be an object`);
    }
    const toolCallId = assertUuidRef(
      item.tool_call_id,
      `auditManifestToolCallLog.tool_call_result_hashes[${index}].tool_call_id`,
    );
    hashToolCallIds.push(toolCallId);
    expectedHashes.set(
      toolCallId,
      assertResultHash(
        item.result_hash,
        `auditManifestToolCallLog.tool_call_result_hashes[${index}].result_hash`,
      ),
    );
  });
  const duplicateHashToolCallIds = duplicateValues(hashToolCallIds);
  const extraToolCallIds = firstSeen(hashToolCallIds.filter((toolCallId) => !toolCallIdSet.has(toolCallId)));
  const duplicateAuditToolCallIds = firstSeen([
    ...duplicateToolCallIds,
    ...duplicateHashToolCallIds,
  ]);
  const missingHashToolCallIds = uniqueToolCallIds.filter((toolCallId) => !expectedHashes.has(toolCallId));
  const missingProvenance =
    hasProvenanceBearingRefs(manifest) &&
    (uniqueToolCallIds.length === 0 || !isStagedSnapshotManifest(manifest));

  if (uniqueToolCallIds.length === 0 || missingProvenance) {
    return Object.freeze({
      ok:
        extraToolCallIds.length === 0 &&
        duplicateAuditToolCallIds.length === 0 &&
        missingHashToolCallIds.length === 0 &&
        !missingProvenance,
      missing_tool_call_ids: Object.freeze([]),
      mismatched_tool_call_ids: Object.freeze([]),
      extra_tool_call_ids: Object.freeze(extraToolCallIds),
      duplicate_tool_call_ids: Object.freeze(duplicateAuditToolCallIds),
      missing_hash_tool_call_ids: Object.freeze(missingHashToolCallIds),
      missing_provenance: missingProvenance,
    });
  }

  const allowedStatuses = freezeAllowedStatuses(
    options.allowed_statuses ?? DEFAULT_TOOL_CALL_AUDIT_STATUSES,
  );
  const values: unknown[] = [uniqueToolCallIds, allowedStatuses];
  const predicates = [
    "tool_call_id = any($1::uuid[])",
    "status = any($2::text[])",
  ];

  if (options.thread_id != null) {
    values.push(assertUuidRef(options.thread_id, "auditManifestToolCallLog.thread_id"));
    predicates.push(`thread_id = $${values.length}::uuid`);
  }

  if (options.agent_id != null) {
    values.push(assertUuidRef(options.agent_id, "auditManifestToolCallLog.agent_id"));
    predicates.push(`agent_id = $${values.length}::uuid`);
  }

  const { rows } = await db.query<{ tool_call_id: string; result_hash: string | null }>(
    `select tool_call_id::text as tool_call_id, result_hash
       from tool_call_logs
      where ${predicates.join(" and ")}`,
    values,
  );
  const found = new Map(rows.map((row) => [row.tool_call_id, row.result_hash]));
  const missing = uniqueToolCallIds.filter((toolCallId) => !found.has(toolCallId));
  const mismatched = uniqueToolCallIds.filter((toolCallId) => {
    if (!found.has(toolCallId)) return false;
    if (!expectedHashes.has(toolCallId)) return false;
    return found.get(toolCallId) !== expectedHashes.get(toolCallId);
  });

  return Object.freeze({
    ok:
      missing.length === 0 &&
      mismatched.length === 0 &&
      extraToolCallIds.length === 0 &&
      duplicateAuditToolCallIds.length === 0 &&
      missingHashToolCallIds.length === 0 &&
      !missingProvenance,
    missing_tool_call_ids: Object.freeze(missing),
    mismatched_tool_call_ids: Object.freeze(mismatched),
    extra_tool_call_ids: Object.freeze(extraToolCallIds),
    duplicate_tool_call_ids: Object.freeze(duplicateAuditToolCallIds),
    missing_hash_tool_call_ids: Object.freeze(missingHashToolCallIds),
    missing_provenance: missingProvenance,
  });
}

function isStagedSnapshotManifest(
  manifest: Pick<SnapshotManifestDraft, typeof STAGED_SNAPSHOT_MANIFEST>,
): boolean {
  return manifest[STAGED_SNAPSHOT_MANIFEST] === true;
}

function hasProvenanceBearingRefs(
  manifest: Partial<
    Pick<
      SnapshotManifestDraft,
      "fact_refs" | "claim_refs" | "event_refs" | "document_refs" | "series_specs" | "source_ids"
    >
  >,
): boolean {
  return [
    manifest.fact_refs,
    manifest.claim_refs,
    manifest.event_refs,
    manifest.document_refs,
    manifest.series_specs,
    manifest.source_ids,
  ].some((refs) => Array.isArray(refs) && refs.length > 0);
}

function firstSeen(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function duplicateValues(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }
    seen.add(value);
  }
  return [...duplicates];
}

class FirstSeenSet<T> {
  private readonly keys = new Set<string>();
  private readonly items: T[] = [];
  private readonly keyFor: (value: T) => string;
  private readonly normalize: (value: T, label: string) => T;

  constructor(
    keyFor: (value: T) => string,
    normalize: (value: T, label: string) => T,
  ) {
    this.keyFor = keyFor;
    this.normalize = normalize;
  }

  add(value: T, label: string): void {
    const normalized = this.normalize(value, label);
    const key = this.keyFor(normalized);
    if (this.keys.has(key)) {
      return;
    }

    this.keys.add(key);
    this.items.push(normalized);
  }

  values(): T[] {
    return [...this.items];
  }
}

function addSubjectRefs(
  accumulator: FirstSeenSet<SnapshotSubjectRef>,
  refs: ReadonlyArray<SnapshotSubjectRef> | undefined,
  label: string,
): void {
  if (refs === undefined) return;
  assertArray(refs, label);
  refs.forEach((ref, index) => {
    accumulator.add(ref, `${label}[${index}]`);
  });
}

function addUuidRefs(
  accumulator: FirstSeenSet<string>,
  refs: ReadonlyArray<string> | undefined,
  label: string,
): void {
  if (refs === undefined) return;
  assertArray(refs, label);
  refs.forEach((ref, index) => {
    accumulator.add(ref, `${label}[${index}]`);
  });
}

function addJsonValues(
  accumulator: FirstSeenSet<JsonValue>,
  values: ReadonlyArray<JsonValue> | undefined,
  label: string,
): void {
  if (values === undefined) return;
  assertArray(values, label);
  values.forEach((value, index) => {
    accumulator.add(value, `${label}[${index}]`);
  });
}

function manifestContributionPayload(
  toolCall: ToolCallManifestContribution,
  index: number,
): JsonObject {
  const payload: JsonObject = {};

  if (toolCall.subject_refs !== undefined) {
    assertArray<SnapshotSubjectRef>(
      toolCall.subject_refs,
      `stageSnapshotManifest.tool_calls[${index}].subject_refs`,
    );
    payload.subject_refs = toolCall.subject_refs.map((subjectRef, subjectIndex) =>
      freezeSubjectRef(
        subjectRef,
        `stageSnapshotManifest.tool_calls[${index}].subject_refs[${subjectIndex}]`,
      ),
    );
  }
  if (toolCall.fact_refs !== undefined) {
    payload.fact_refs = normalizedUuidArray(
      toolCall.fact_refs,
      `stageSnapshotManifest.tool_calls[${index}].fact_refs`,
    );
  }
  if (toolCall.claim_refs !== undefined) {
    payload.claim_refs = normalizedUuidArray(
      toolCall.claim_refs,
      `stageSnapshotManifest.tool_calls[${index}].claim_refs`,
    );
  }
  if (toolCall.event_refs !== undefined) {
    payload.event_refs = normalizedUuidArray(
      toolCall.event_refs,
      `stageSnapshotManifest.tool_calls[${index}].event_refs`,
    );
  }
  if (toolCall.document_refs !== undefined) {
    payload.document_refs = normalizedUuidArray(
      toolCall.document_refs,
      `stageSnapshotManifest.tool_calls[${index}].document_refs`,
    );
  }
  if (toolCall.series_specs !== undefined) {
    assertArray<JsonValue>(
      toolCall.series_specs,
      `stageSnapshotManifest.tool_calls[${index}].series_specs`,
    );
    payload.series_specs = toolCall.series_specs.map((value, valueIndex) =>
      cloneJsonValue(
        value,
        `stageSnapshotManifest.tool_calls[${index}].series_specs[${valueIndex}]`,
      ),
    );
  }
  if (toolCall.source_ids !== undefined) {
    payload.source_ids = normalizedUuidArray(
      toolCall.source_ids,
      `stageSnapshotManifest.tool_calls[${index}].source_ids`,
    );
  }

  return payload;
}

function toolCallResultHash(
  toolCall: ToolCallManifestContribution,
  index: number,
  contributionPayload: JsonObject,
): string {
  if (toolCall.result === undefined) {
    return hashJsonValue(contributionPayload);
  }

  const result = cloneJsonValue(
    toolCall.result,
    `stageSnapshotManifest.tool_calls[${index}].result`,
  );
  if (!isJsonObject(result)) {
    throw new Error(`stageSnapshotManifest.tool_calls[${index}].result: must be an object`);
  }
  const embeddedContribution = result.manifest_contribution;
  assertJsonValue(
    embeddedContribution,
    `stageSnapshotManifest.tool_calls[${index}].result.manifest_contribution`,
    new Set<object>(),
  );
  if (stableJson(embeddedContribution) !== stableJson(contributionPayload)) {
    throw new Error(`stageSnapshotManifest.tool_calls[${index}].result.manifest_contribution: must match staged refs`);
  }
  return hashJsonValue(result);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedUuidArray(values: unknown, label: string): string[] {
  assertArray<string>(values, label);
  return values.map((value, index) => assertUuidRef(value, `${label}[${index}]`));
}

function freezeSubjectRef(
  value: SnapshotSubjectRef,
  label: string,
): SnapshotSubjectRef {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label}: must be an object`);
  }
  assertOneOf(value.kind, SNAPSHOT_SUBJECT_KINDS, `${label}.kind`);
  const id = assertUuidRef(value.id, `${label}.id`);

  return Object.freeze({
    kind: value.kind,
    id,
  });
}

function assertUuidRef(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new Error(`${label}: must be a UUID v4`);
  }
  return value.toLowerCase();
}

function assertResultHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_HASH.test(value)) {
    throw new Error(`${label}: must be a sha256 result hash`);
  }
  return value;
}

function optionalUuid(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return assertUuidRef(value, label);
}

function optionalNonEmptyString(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value == null) return null;
  assertNonEmptyString(value, label);
  return value;
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}: must be a non-empty string`);
  }
}

function assertNonEmptyArray<T>(value: ReadonlyArray<T>, label: string): void {
  if (value.length === 0) {
    throw new Error(`${label}: must include at least one item`);
  }
}

function assertArray<T>(value: unknown, label: string): asserts value is ReadonlyArray<T> {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: must be an array`);
  }
}

function assertOneOf<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  label: string,
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label}: must be one of ${allowed.join(", ")}`);
  }
}

function canonicalTimestamp(value: unknown, label: string): string {
  assertIso8601WithOffset(value, label);
  return new Date(value).toISOString();
}

function assertIso8601WithOffset(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset`);
  }

  const match = ISO_8601_WITH_OFFSET.exec(value);
  if (!match || !isValidTimestampMatch(match) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset`);
  }
}

function isValidTimestampMatch(match: RegExpExecArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHourText = match[10];
  const offsetMinuteText = match[11];

  if (
    !isValidDate(year, month, day) ||
    !isInRange(hour, 0, 23) ||
    !isInRange(minute, 0, 59) ||
    !isInRange(second, 0, 59)
  ) {
    return false;
  }

  if (offsetHourText === undefined || offsetMinuteText === undefined) {
    return true;
  }

  return (
    isInRange(Number(offsetHourText), 0, 23) &&
    isInRange(Number(offsetMinuteText), 0, 59)
  );
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !isInRange(month, 1, 12)) {
    return false;
  }

  return isInRange(day, 1, daysInMonth(year, month));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function freezeAllowedStatuses(statuses: ReadonlyArray<string>): ReadonlyArray<string> {
  assertArray<string>(statuses, "auditManifestToolCallLog.allowed_statuses");
  assertNonEmptyArray(statuses, "auditManifestToolCallLog.allowed_statuses");
  return Object.freeze(
    statuses.map((status, index) => {
      assertNonEmptyString(
        status,
        `auditManifestToolCallLog.allowed_statuses[${index}]`,
      );
      return status;
    }),
  );
}

function cloneJsonValue(value: JsonValue, label: string): JsonValue {
  assertJsonValue(value, label, new Set<object>());
  return JSON.parse(stableJson(value)) as JsonValue;
}

function hashJsonValue(value: JsonValue): string {
  assertJsonValue(value, "stageSnapshotManifest.tool_call_result_hash", new Set<object>());
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function assertJsonValue(
  value: unknown,
  label: string,
  seen: Set<object>,
): asserts value is JsonValue {
  if (value === null) return;

  switch (typeof value) {
    case "boolean":
    case "string":
      return;
    case "number":
      if (Number.isFinite(value)) return;
      throw new TypeError(`${label}: JSON value contains a non-finite number`);
    case "bigint":
    case "undefined":
    case "function":
    case "symbol":
      throw new TypeError(`${label}: JSON value contains an unsupported ${typeof value}`);
    case "object":
      break;
    default:
      throw new TypeError(`${label}: JSON value contains an unsupported value`);
  }

  if (seen.has(value)) {
    throw new TypeError(`${label}: JSON value contains a circular reference`);
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        assertJsonValue(item, `${label}[${index}]`, seen);
      });
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label}: JSON value contains a non-plain object`);
    }

    Object.entries(value).forEach(([key, child]) => {
      assertJsonValue(child, `${label}.${key}`, seen);
    });
  } finally {
    seen.delete(value);
  }
}

function deepFreezeJson<T extends JsonValue>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      value.forEach((item) => deepFreezeJson(item));
    } else {
      Object.values(value).forEach((item) => deepFreezeJson(item));
    }
    Object.freeze(value);
  }

  return value;
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}
