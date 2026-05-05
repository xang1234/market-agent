import type { QueryExecutor } from "./types.ts";
import {
  assertIso8601WithOffset,
  assertNonEmptyString,
  assertOneOf,
  assertOptionalNonEmptyString,
  assertUuidV4,
} from "./validators.ts";
import { PROMOTION_VERIFICATION_STATUSES, type PromotionVerificationStatus } from "./promotion-rules.ts";

export const FACT_SUBJECT_KINDS = Object.freeze([
  "issuer",
  "instrument",
  "listing",
  "theme",
  "macro_topic",
  "portfolio",
  "screen",
] as const);

export const FACT_PERIOD_KINDS = Object.freeze(["point", "fiscal_q", "fiscal_y", "ttm", "range"] as const);
export const FACT_METHODS = Object.freeze(["reported", "derived", "estimated", "vendor", "extracted"] as const);
export const FRESHNESS_CLASSES = Object.freeze(["real_time", "delayed_15m", "eod", "filing_time", "stale"] as const);
export const COVERAGE_LEVELS = Object.freeze(["full", "partial", "sparse", "unavailable"] as const);
export const FACT_REVIEW_STATUSES = Object.freeze(["queued", "reviewed", "dismissed"] as const);
export const FACT_ENTITLEMENT_CHANNELS = Object.freeze(["app", "export", "email", "push"] as const);

export type FactSubjectKind = (typeof FACT_SUBJECT_KINDS)[number];
export type FactPeriodKind = (typeof FACT_PERIOD_KINDS)[number];
export type FactMethod = (typeof FACT_METHODS)[number];
export type FreshnessClass = (typeof FRESHNESS_CLASSES)[number];
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];
export type FactReviewStatus = (typeof FACT_REVIEW_STATUSES)[number];
export type FactEntitlementChannel = (typeof FACT_ENTITLEMENT_CHANNELS)[number];

export type FactInput = Readonly<{
  subject_kind: FactSubjectKind;
  subject_id: string;
  metric_id: string;
  period_kind: FactPeriodKind;
  period_start?: string | null;
  period_end?: string | null;
  fiscal_year?: number | null;
  fiscal_period?: string | null;
  value_num?: number | null;
  value_text?: string | null;
  unit: string;
  currency?: string | null;
  scale?: number;
  as_of: string;
  reported_at?: string | null;
  observed_at: string;
  source_id: string;
  method: FactMethod;
  adjustment_basis?: string | null;
  definition_version?: number;
  verification_status: PromotionVerificationStatus;
  freshness_class: FreshnessClass;
  coverage_level: CoverageLevel;
  quality_flags?: readonly unknown[];
  entitlement_channels?: readonly string[];
  confidence: number;
  ingestion_batch_id?: string | null;
}>;

export type FactRow = Required<Omit<FactInput, "quality_flags" | "entitlement_channels">> & {
  fact_id: string;
  scale: number;
  definition_version: number;
  quality_flags: readonly unknown[];
  entitlement_channels: readonly string[];
  supersedes: string | null;
  superseded_by: string | null;
  invalidated_at: string | null;
  ingestion_batch_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SupersedeFactResult = Readonly<{
  new_fact: FactRow;
  superseded_fact: FactRow;
}>;

export type QueueFactReviewInput = Readonly<{
  candidate: FactInput;
  reason: string;
  source_id?: string | null;
  metric_id?: string | null;
  confidence: number;
  threshold: number;
}>;

export type FactReviewQueueRow = Readonly<{
  review_id: string;
  candidate: FactInput;
  reason: string;
  source_id: string | null;
  metric_id: string | null;
  confidence: number;
  threshold: number;
  status: FactReviewStatus;
  created_at: string;
  updated_at: string;
}>;

export type ListFactsForEgressInput = Readonly<{
  fact_ids: readonly string[];
  channel: FactEntitlementChannel;
}>;

export class FactEgressEntitlementError extends Error {
  readonly channel: FactEntitlementChannel;
  readonly denied_fact_ids: readonly string[];

  constructor(channel: FactEntitlementChannel, deniedFactIds: readonly string[]) {
    super(`facts are not entitled for ${channel}: ${deniedFactIds.join(", ")}`);
    this.name = "FactEgressEntitlementError";
    this.channel = channel;
    this.denied_fact_ids = Object.freeze([...deniedFactIds]);
  }
}

export type FactPoolClient = QueryExecutor & {
  release(destroy?: boolean): void;
};

export type FactClientPool = Readonly<{
  connect(): Promise<FactPoolClient>;
}>;

type CreateFactOptions = Readonly<{ supersedes?: string | null }>;
type NormalizedFactInput = Required<FactInput>;
type FactDbRow = Omit<FactRow, "value_num" | "scale" | "confidence" | "created_at" | "updated_at" | "invalidated_at"> & {
  value_num: number | string | null;
  scale: number | string;
  confidence: number | string;
  as_of: Date | string;
  reported_at: Date | string | null;
  observed_at: Date | string;
  invalidated_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};
type FactReviewQueueDbRow = Omit<FactReviewQueueRow, "confidence" | "threshold" | "created_at" | "updated_at"> & {
  confidence: number | string;
  threshold: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

const FACT_COLUMNS = `fact_id,
               subject_kind,
               subject_id,
               metric_id,
               period_kind,
               period_start,
               period_end,
               fiscal_year,
               fiscal_period,
               value_num,
               value_text,
               unit,
               currency,
               scale,
               as_of,
               reported_at,
               observed_at,
               source_id,
               method,
               adjustment_basis,
               definition_version,
               verification_status,
               freshness_class,
               coverage_level,
               quality_flags,
               entitlement_channels,
               confidence,
               supersedes,
               superseded_by,
               invalidated_at,
               ingestion_batch_id,
               created_at,
               updated_at`;

export async function createFact(
  db: QueryExecutor,
  input: FactInput,
  options: CreateFactOptions = {},
): Promise<FactRow> {
  const normalized = normalizeFactInput(input);
  if (options.supersedes != null) assertUuidV4(options.supersedes, "supersedes");

  const { rows } = await db.query<FactDbRow>(
    `insert into facts
       (subject_kind,
        subject_id,
        metric_id,
        period_kind,
        period_start,
        period_end,
        fiscal_year,
        fiscal_period,
        value_num,
        value_text,
        unit,
        currency,
        scale,
        as_of,
        reported_at,
        observed_at,
        source_id,
        method,
        adjustment_basis,
        definition_version,
        verification_status,
        freshness_class,
        coverage_level,
        quality_flags,
        entitlement_channels,
        confidence,
        supersedes,
        ingestion_batch_id)
     values ($1::subject_kind, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             $17::uuid, $18::fact_method, $19, $20, $21::verification_status, $22::freshness_class,
             $23::coverage_level, $24::jsonb, $25::jsonb, $26, $27, $28)
     returning ${FACT_COLUMNS}`,
    [
      normalized.subject_kind,
      normalized.subject_id,
      normalized.metric_id,
      normalized.period_kind,
      normalized.period_start,
      normalized.period_end,
      normalized.fiscal_year,
      normalized.fiscal_period,
      normalized.value_num,
      normalized.value_text,
      normalized.unit,
      normalized.currency,
      normalized.scale,
      normalized.as_of,
      normalized.reported_at,
      normalized.observed_at,
      normalized.source_id,
      normalized.method,
      normalized.adjustment_basis,
      normalized.definition_version,
      normalized.verification_status,
      normalized.freshness_class,
      normalized.coverage_level,
      JSON.stringify(normalized.quality_flags),
      JSON.stringify(normalized.entitlement_channels),
      normalized.confidence,
      options.supersedes ?? null,
      normalized.ingestion_batch_id,
    ],
  );

  return factRowFromDb(rows[0]);
}

export async function supersedeFact(
  db: QueryExecutor,
  supersededFactId: string,
  input: FactInput,
): Promise<SupersedeFactResult> {
  if (isPoolLike(db)) {
    throw new Error("supersedeFact requires a pinned transaction client; use supersedeFactWithPool for pools");
  }
  assertUuidV4(supersededFactId, "superseded_fact_id");

  await db.query("begin");
  try {
    const normalized = normalizeFactInput(input);
    const existingFact = await lockSupersededFact(db, supersededFactId);
    assertFactIdentityMatches(existingFact, normalized);
    if (existingFact.superseded_by != null) {
      throw new Error("supersedeFact: superseded fact is already superseded");
    }

    const newFact = await createFact(db, normalized, { supersedes: supersededFactId });
    const { rows } = await db.query<FactDbRow>(
      `update facts
          set superseded_by = $2,
              updated_at = now()
        where fact_id = $1
          and superseded_by is null
        returning ${FACT_COLUMNS}`,
      [supersededFactId, newFact.fact_id],
    );
    if (rows.length !== 1) {
      throw new Error("supersedeFact: superseded fact was not found or is already superseded");
    }
    await db.query("commit");
    return Object.freeze({
      new_fact: newFact,
      superseded_fact: factRowFromDb(rows[0]),
    });
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export async function supersedeFactWithPool(
  pool: FactClientPool,
  supersededFactId: string,
  input: FactInput,
): Promise<SupersedeFactResult> {
  const client = await pool.connect();
  let destroyClient = false;
  try {
    return await supersedeFact(client, supersededFactId, input);
  } catch (error) {
    destroyClient = true;
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

export async function queueFactReview(
  db: QueryExecutor,
  input: QueueFactReviewInput,
): Promise<FactReviewQueueRow> {
  const normalized = {
    ...normalizeFactInput(input.candidate),
    verification_status: "candidate" as const,
  };
  assertNonEmptyString(input.reason, "reason");
  assertQueuedColumnMatchesCandidate(input.source_id, normalized.source_id, "source_id");
  assertQueuedColumnMatchesCandidate(input.metric_id, normalized.metric_id, "metric_id");
  assertConfidence(input.confidence, "confidence");
  assertConfidence(input.threshold, "threshold");

  const { rows } = await db.query<FactReviewQueueDbRow>(
    `insert into fact_review_queue
       (candidate, reason, source_id, metric_id, confidence, threshold)
     values ($1::jsonb, $2, $3, $4, $5, $6)
     returning review_id,
               candidate,
               reason,
               source_id,
               metric_id,
               confidence,
               threshold,
               status,
               created_at,
               updated_at`,
    [
      normalized,
      input.reason,
      normalized.source_id,
      normalized.metric_id,
      input.confidence,
      input.threshold,
    ],
  );

  return factReviewQueueRowFromDb(rows[0]);
}

export async function listFactsForEgress(
  db: QueryExecutor,
  input: ListFactsForEgressInput,
): Promise<ReadonlyArray<FactRow>> {
  assertOneOf(input.channel, FACT_ENTITLEMENT_CHANNELS, "channel");
  if (!Array.isArray(input.fact_ids)) {
    throw new Error("fact_ids: must be an array");
  }
  const factIds = [...input.fact_ids];
  for (const factId of factIds) {
    assertUuidV4(factId, "fact_ids");
  }
  if (factIds.length === 0) return Object.freeze([]);

  const { rows } = await db.query<FactDbRow>(
    `select ${FACT_COLUMNS}
       from facts
      where fact_id = any($1::uuid[])
        and entitlement_channels ? $2
      order by array_position($1::uuid[], fact_id)`,
    [factIds, input.channel],
  );
  const facts = Object.freeze(rows.map(factRowFromDb));
  const returned = new Set(facts.map((fact) => fact.fact_id));
  const denied = factIds.filter((factId) => !returned.has(factId));
  if (denied.length > 0) {
    throw new FactEgressEntitlementError(input.channel, denied);
  }
  return facts;
}

async function lockSupersededFact(db: QueryExecutor, supersededFactId: string): Promise<FactRow> {
  const { rows } = await db.query<FactDbRow>(
    `select ${FACT_COLUMNS}
       from facts
      where fact_id = $1
      for update`,
    [supersededFactId],
  );
  if (rows.length !== 1) {
    throw new Error("supersedeFact: superseded fact was not found");
  }
  return factRowFromDb(rows[0]);
}

function assertFactIdentityMatches(existing: FactRow, input: NormalizedFactInput): void {
  const identityMatches =
    existing.subject_kind === input.subject_kind &&
    existing.subject_id === input.subject_id &&
    existing.metric_id === input.metric_id &&
    existing.period_kind === input.period_kind &&
    sameNullableText(existing.period_start, input.period_start) &&
    sameNullableText(existing.period_end, input.period_end) &&
    existing.fiscal_year === input.fiscal_year &&
    existing.fiscal_period === input.fiscal_period &&
    existing.unit === input.unit &&
    existing.currency === input.currency &&
    existing.definition_version === input.definition_version;

  if (!identityMatches) {
    throw new Error("supersedeFact: input identity does not match superseded fact");
  }
}

function assertQueuedColumnMatchesCandidate(override: string | null | undefined, candidateValue: string, label: string): void {
  if (override == null) return;
  assertUuidV4(override, label);
  if (override !== candidateValue) {
    throw new Error(`${label}: must match candidate.${label}`);
  }
}

function sameNullableText(left: string | Date | null, right: string | null): boolean {
  return nullableIsoDateText(left) === right;
}

function nullableIsoDateText(value: string | Date | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

function normalizeFactInput(input: FactInput): NormalizedFactInput {
  assertOneOf(input.subject_kind, FACT_SUBJECT_KINDS, "subject_kind");
  assertUuidV4(input.subject_id, "subject_id");
  assertUuidV4(input.metric_id, "metric_id");
  assertOneOf(input.period_kind, FACT_PERIOD_KINDS, "period_kind");
  assertOptionalDate(input.period_start, "period_start");
  assertOptionalDate(input.period_end, "period_end");
  if (input.fiscal_year != null && !Number.isInteger(input.fiscal_year)) {
    throw new Error("fiscal_year: must be an integer");
  }
  assertOptionalNonEmptyString(input.fiscal_period, "fiscal_period");
  assertOptionalFactValue(input.value_num, "value_num");
  assertOptionalNonEmptyString(input.value_text, "value_text");
  if (input.value_num == null && input.value_text == null) {
    throw new Error("fact value: value_num or value_text is required");
  }
  assertNonEmptyString(input.unit, "unit");
  assertOptionalNonEmptyString(input.currency, "currency");
  const scale = input.scale ?? 1;
  assertPositiveFiniteNumber(scale, "scale");
  assertIso8601WithOffset(input.as_of, "as_of");
  if (input.reported_at != null) assertIso8601WithOffset(input.reported_at, "reported_at");
  assertIso8601WithOffset(input.observed_at, "observed_at");
  assertUuidV4(input.source_id, "source_id");
  assertOneOf(input.method, FACT_METHODS, "method");
  assertOptionalNonEmptyString(input.adjustment_basis, "adjustment_basis");
  const definitionVersion = input.definition_version ?? 1;
  if (!Number.isInteger(definitionVersion) || definitionVersion <= 0) {
    throw new Error("definition_version: must be a positive integer");
  }
  assertOneOf(input.verification_status, PROMOTION_VERIFICATION_STATUSES, "verification_status");
  assertOneOf(input.freshness_class, FRESHNESS_CLASSES, "freshness_class");
  assertOneOf(input.coverage_level, COVERAGE_LEVELS, "coverage_level");
  assertEntitlementChannels(input.entitlement_channels ?? ["app"]);
  assertConfidence(input.confidence, "confidence");
  if (input.ingestion_batch_id != null) assertUuidV4(input.ingestion_batch_id, "ingestion_batch_id");

  return {
    subject_kind: input.subject_kind,
    subject_id: input.subject_id,
    metric_id: input.metric_id,
    period_kind: input.period_kind,
    period_start: input.period_start ?? null,
    period_end: input.period_end ?? null,
    fiscal_year: input.fiscal_year ?? null,
    fiscal_period: input.fiscal_period ?? null,
    value_num: input.value_num ?? null,
    value_text: input.value_text ?? null,
    unit: input.unit,
    currency: input.currency ?? null,
    scale,
    as_of: input.as_of,
    reported_at: input.reported_at ?? null,
    observed_at: input.observed_at,
    source_id: input.source_id,
    method: input.method,
    adjustment_basis: input.adjustment_basis ?? null,
    definition_version: definitionVersion,
    verification_status: input.verification_status,
    freshness_class: input.freshness_class,
    coverage_level: input.coverage_level,
    quality_flags: input.quality_flags ?? [],
    entitlement_channels: input.entitlement_channels ?? ["app"],
    confidence: input.confidence,
    ingestion_batch_id: input.ingestion_batch_id ?? null,
  };
}

function factRowFromDb(row: FactDbRow | undefined): FactRow {
  if (!row) {
    throw new Error("fact insert/select did not return a row");
  }
  return Object.freeze({
    fact_id: row.fact_id,
    subject_kind: row.subject_kind,
    subject_id: row.subject_id,
    metric_id: row.metric_id,
    period_kind: row.period_kind,
    period_start: row.period_start,
    period_end: row.period_end,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
    value_num: row.value_num == null ? null : Number(row.value_num),
    value_text: row.value_text,
    unit: row.unit,
    currency: row.currency,
    scale: Number(row.scale),
    as_of: isoString(row.as_of),
    reported_at: nullableIsoString(row.reported_at),
    observed_at: isoString(row.observed_at),
    source_id: row.source_id,
    method: row.method,
    adjustment_basis: row.adjustment_basis,
    definition_version: row.definition_version,
    verification_status: row.verification_status,
    freshness_class: row.freshness_class,
    coverage_level: row.coverage_level,
    quality_flags: Object.freeze(row.quality_flags),
    entitlement_channels: Object.freeze(row.entitlement_channels),
    confidence: Number(row.confidence),
    supersedes: row.supersedes,
    superseded_by: row.superseded_by,
    invalidated_at: nullableIsoString(row.invalidated_at),
    ingestion_batch_id: row.ingestion_batch_id,
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  });
}

function factReviewQueueRowFromDb(row: FactReviewQueueDbRow | undefined): FactReviewQueueRow {
  if (!row) {
    throw new Error("fact review queue insert did not return a row");
  }
  assertOneOf(row.status, FACT_REVIEW_STATUSES, "status");
  return Object.freeze({
    review_id: row.review_id,
    candidate: row.candidate,
    reason: row.reason,
    source_id: row.source_id,
    metric_id: row.metric_id,
    confidence: Number(row.confidence),
    threshold: Number(row.threshold),
    status: row.status,
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  });
}

function assertOptionalDate(value: unknown, label: string): asserts value is string | null | undefined {
  if (value == null) return;
  if (typeof value !== "string" || !isIsoCalendarDate(value)) {
    throw new Error(`${label}: must be an ISO date YYYY-MM-DD`);
  }
}

function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function assertOptionalFactValue(value: unknown, label: string): asserts value is number | null | undefined {
  if (value == null) return;
  assertFiniteNumber(value, label);
}

function assertPositiveFiniteNumber(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  if (value <= 0) throw new Error(`${label}: must be positive`);
}

function assertConfidence(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  if (value < 0 || value > 1) throw new Error(`${label}: must be in [0, 1]`);
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}: must be a finite number`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`${label}: must be an array of non-empty strings`);
  }
}

function assertEntitlementChannels(value: unknown): asserts value is readonly FactEntitlementChannel[] {
  assertStringArray(value, "entitlement_channels");
  if (value.length === 0) {
    throw new Error("entitlement_channels: must not be empty");
  }
  for (const channel of value) {
    assertOneOf(channel, FACT_ENTITLEMENT_CHANNELS, "entitlement_channels");
  }
}

function isPoolLike(value: QueryExecutor): boolean {
  return typeof (value as Partial<FactClientPool>).connect === "function";
}

function nullableIsoString(value: Date | string | null): string | null {
  return value == null ? null : isoString(value);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
