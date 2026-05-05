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
export const FACT_REVIEW_ACTIONS = Object.freeze(["approved", "rejected", "edited"] as const);
export const FACT_ENTITLEMENT_CHANNELS = Object.freeze(["app", "export", "email", "push"] as const);

export type FactSubjectKind = (typeof FACT_SUBJECT_KINDS)[number];
export type FactPeriodKind = (typeof FACT_PERIOD_KINDS)[number];
export type FactMethod = (typeof FACT_METHODS)[number];
export type FreshnessClass = (typeof FRESHNESS_CLASSES)[number];
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];
export type FactReviewStatus = (typeof FACT_REVIEW_STATUSES)[number];
export type FactReviewAction = (typeof FACT_REVIEW_ACTIONS)[number];
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
  reviewed_by: string | null;
  reviewed_at: string | null;
  fact_id: string | null;
}>;

export type FactReviewActionRow = Readonly<{
  action_id: string;
  review_id: string;
  action: FactReviewAction;
  reviewer_id: string;
  notes: string | null;
  candidate_before: FactInput;
  candidate_after: FactInput | null;
  fact_id: string | null;
  created_at: string;
}>;

export type ListFactReviewQueueInput = Readonly<{
  status?: FactReviewStatus;
  limit?: number;
}>;

export type ListStaleFactReviewQueueInput = Readonly<{
  now: string;
  stale_after_seconds: number;
  limit?: number;
}>;

export type StaleFactReviewQueueRow = FactReviewQueueRow & Readonly<{
  age_seconds: number;
  stale_after_seconds: number;
}>;

export type ApproveFactReviewInput = Readonly<{
  review_id: string;
  reviewer_id: string;
  notes?: string | null;
  candidate?: FactInput;
  reviewed_at?: string;
  throughput_limit?: FactReviewThroughputLimit;
}>;

export type ApproveFactReviewResult = Readonly<{
  review: FactReviewQueueRow;
  fact: FactRow;
  action: FactReviewActionRow;
}>;

export type RejectFactReviewInput = Readonly<{
  review_id: string;
  reviewer_id: string;
  notes?: string | null;
  reviewed_at?: string;
  throughput_limit?: FactReviewThroughputLimit;
}>;

export type EditFactReviewCandidateInput = Readonly<{
  review_id: string;
  reviewer_id: string;
  candidate: FactInput;
  notes?: string | null;
  reviewed_at?: string;
  throughput_limit?: FactReviewThroughputLimit;
}>;

export type FactReviewThroughputLimit = Readonly<{
  max_actions: number;
  window_seconds: number;
}>;

export class FactReviewThroughputExceededError extends Error {
  readonly reviewer_id: string;
  readonly max_actions: number;
  readonly window_seconds: number;

  constructor(input: { reviewer_id: string; max_actions: number; window_seconds: number }) {
    super(
      `reviewer throughput limit exceeded: ${input.max_actions} actions per ${input.window_seconds} seconds`,
    );
    this.name = "FactReviewThroughputExceededError";
    this.reviewer_id = input.reviewer_id;
    this.max_actions = input.max_actions;
    this.window_seconds = input.window_seconds;
  }
}

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
type FactReviewQueueDbRow = Omit<
  FactReviewQueueRow,
  "confidence" | "threshold" | "created_at" | "updated_at" | "reviewed_at"
> & {
  confidence: number | string;
  threshold: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  reviewed_at: Date | string | null;
};
type StaleFactReviewQueueDbRow = FactReviewQueueDbRow & {
  age_seconds: number | string;
  stale_after_seconds: number | string;
};
type FactReviewActionDbRow = Omit<FactReviewActionRow, "created_at"> & {
  created_at: Date | string;
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

const FACT_REVIEW_QUEUE_COLUMNS = `review_id,
               candidate,
               reason,
               source_id,
               metric_id,
               confidence,
               threshold,
               status,
               created_at,
               updated_at,
               reviewed_by,
               reviewed_at,
               fact_id`;

const FACT_REVIEW_ACTION_COLUMNS = `action_id,
               review_id,
               action,
               reviewer_id,
               notes,
               candidate_before,
               candidate_after,
               fact_id,
               created_at`;

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
               updated_at,
               reviewed_by,
               reviewed_at,
               fact_id`,
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

export async function listFactReviewQueue(
  db: QueryExecutor,
  input: ListFactReviewQueueInput = {},
): Promise<ReadonlyArray<FactReviewQueueRow>> {
  const limit = input.limit ?? 50;
  assertPositiveIntegerInRange(limit, "limit", 1, 100);

  if (input.status != null) {
    assertOneOf(input.status, FACT_REVIEW_STATUSES, "status");
    const { rows } = await db.query<FactReviewQueueDbRow>(
      `select ${FACT_REVIEW_QUEUE_COLUMNS}
         from fact_review_queue
        where status = $1
        order by created_at asc, review_id asc
        limit $2`,
      [input.status, limit],
    );
    return Object.freeze(rows.map(factReviewQueueRowFromDb));
  }

  const { rows } = await db.query<FactReviewQueueDbRow>(
    `select ${FACT_REVIEW_QUEUE_COLUMNS}
       from fact_review_queue
      order by created_at asc, review_id asc
      limit $1`,
    [limit],
  );
  return Object.freeze(rows.map(factReviewQueueRowFromDb));
}

export async function listStaleFactReviewQueueItems(
  db: QueryExecutor,
  input: ListStaleFactReviewQueueInput,
): Promise<ReadonlyArray<StaleFactReviewQueueRow>> {
  assertIso8601WithOffset(input.now, "now");
  assertPositiveIntegerInRange(input.stale_after_seconds, "stale_after_seconds", 1, 30 * 24 * 60 * 60);
  const limit = input.limit ?? 50;
  assertPositiveIntegerInRange(limit, "limit", 1, 100);

  const { rows } = await db.query<StaleFactReviewQueueDbRow>(
    `select ${FACT_REVIEW_QUEUE_COLUMNS},
            extract(epoch from ($1::timestamptz - created_at))::int as age_seconds,
            $2::int as stale_after_seconds
       from fact_review_queue
      where status = 'queued'
        and created_at <= $1::timestamptz - ($2 * interval '1 second')
      order by created_at asc, review_id asc
      limit $3`,
    [input.now, input.stale_after_seconds, limit],
  );
  return Object.freeze(rows.map(staleFactReviewQueueRowFromDb));
}

export async function approveFactReview(
  db: QueryExecutor,
  input: ApproveFactReviewInput,
): Promise<ApproveFactReviewResult> {
  assertReviewActionInput(input.review_id, input.reviewer_id, input.reviewed_at);
  const notes = normalizeOptionalNotes(input.notes);
  const reviewedAt = input.reviewed_at ?? new Date().toISOString();
  if (isPoolLike(db)) {
    throw new Error("approveFactReview requires a pinned transaction client");
  }

  await db.query("begin");
  try {
    const locked = await lockQueuedFactReview(db, input.review_id);
    await assertReviewerThroughputAvailable(db, input.reviewer_id, input.throughput_limit);
    const candidateBefore = normalizeReviewCandidate(locked.candidate);
    const candidateAfter = input.candidate == null ? candidateBefore : normalizeReviewCandidate(input.candidate);
    const fact = await createFact(db, {
      ...candidateAfter,
      verification_status: "authoritative",
      quality_flags: [
        ...candidateAfter.quality_flags,
        reviewProvenanceFlag({
          action: "approved",
          review_id: input.review_id,
          reviewer_id: input.reviewer_id,
          reviewed_at: reviewedAt,
        }),
      ],
    });
    const review = await updateFactReviewAsApproved(
      db,
      input.review_id,
      candidateAfter,
      input.reviewer_id,
      reviewedAt,
      fact.fact_id,
    );
    const action = await insertFactReviewAction(db, {
      review_id: input.review_id,
      action: "approved",
      reviewer_id: input.reviewer_id,
      notes,
      candidate_before: candidateBefore,
      candidate_after: candidateAfter,
      fact_id: fact.fact_id,
    });
    await db.query("commit");
    return Object.freeze({ review, fact, action });
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export async function approveFactReviewWithPool(
  pool: FactClientPool,
  input: ApproveFactReviewInput,
): Promise<ApproveFactReviewResult> {
  return withFactReviewClient(pool, (client) => approveFactReview(client, input));
}

export async function rejectFactReview(
  db: QueryExecutor,
  input: RejectFactReviewInput,
): Promise<FactReviewQueueRow> {
  assertReviewActionInput(input.review_id, input.reviewer_id, input.reviewed_at);
  const notes = normalizeOptionalNotes(input.notes);
  const reviewedAt = input.reviewed_at ?? new Date().toISOString();
  if (isPoolLike(db)) {
    throw new Error("rejectFactReview requires a pinned transaction client");
  }

  await db.query("begin");
  try {
    const locked = await lockQueuedFactReview(db, input.review_id);
    await assertReviewerThroughputAvailable(db, input.reviewer_id, input.throughput_limit);
    const candidateBefore = normalizeReviewCandidate(locked.candidate);
    const review = await updateFactReviewAsRejected(db, input.review_id, input.reviewer_id, reviewedAt);
    await insertFactReviewAction(db, {
      review_id: input.review_id,
      action: "rejected",
      reviewer_id: input.reviewer_id,
      notes,
      candidate_before: candidateBefore,
      candidate_after: null,
      fact_id: null,
    });
    await db.query("commit");
    return review;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export async function rejectFactReviewWithPool(
  pool: FactClientPool,
  input: RejectFactReviewInput,
): Promise<FactReviewQueueRow> {
  return withFactReviewClient(pool, (client) => rejectFactReview(client, input));
}

export async function editFactReviewCandidate(
  db: QueryExecutor,
  input: EditFactReviewCandidateInput,
): Promise<FactReviewQueueRow> {
  assertReviewActionInput(input.review_id, input.reviewer_id, input.reviewed_at);
  const notes = normalizeOptionalNotes(input.notes);
  if (isPoolLike(db)) {
    throw new Error("editFactReviewCandidate requires a pinned transaction client");
  }

  await db.query("begin");
  try {
    const locked = await lockQueuedFactReview(db, input.review_id);
    await assertReviewerThroughputAvailable(db, input.reviewer_id, input.throughput_limit);
    const candidateBefore = normalizeReviewCandidate(locked.candidate);
    const candidateAfter = normalizeReviewCandidate(input.candidate);
    const review = await updateFactReviewCandidate(db, input.review_id, candidateAfter);
    await insertFactReviewAction(db, {
      review_id: input.review_id,
      action: "edited",
      reviewer_id: input.reviewer_id,
      notes,
      candidate_before: candidateBefore,
      candidate_after: candidateAfter,
      fact_id: null,
    });
    await db.query("commit");
    return review;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export async function editFactReviewCandidateWithPool(
  pool: FactClientPool,
  input: EditFactReviewCandidateInput,
): Promise<FactReviewQueueRow> {
  return withFactReviewClient(pool, (client) => editFactReviewCandidate(client, input));
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

async function withFactReviewClient<T>(
  pool: FactClientPool,
  action: (client: FactPoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let destroyClient = false;
  try {
    return await action(client);
  } catch (error) {
    destroyClient = true;
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

async function lockQueuedFactReview(db: QueryExecutor, reviewId: string): Promise<FactReviewQueueRow> {
  const { rows } = await db.query<FactReviewQueueDbRow>(
    `select ${FACT_REVIEW_QUEUE_COLUMNS}
       from fact_review_queue
      where review_id = $1
        and status = 'queued'
      for update`,
    [reviewId],
  );
  if (rows.length !== 1) {
    throw new Error("fact review queue item was not found or is no longer queued");
  }
  return factReviewQueueRowFromDb(rows[0]);
}

async function updateFactReviewAsApproved(
  db: QueryExecutor,
  reviewId: string,
  candidate: NormalizedFactInput,
  reviewerId: string,
  reviewedAt: string,
  factId: string,
): Promise<FactReviewQueueRow> {
  const { rows } = await db.query<FactReviewQueueDbRow>(
    `update fact_review_queue
        set status = 'reviewed',
            candidate = $2::jsonb,
            reviewed_by = $3,
            reviewed_at = $4,
            fact_id = $5,
            updated_at = now()
      where review_id = $1
        and status = 'queued'
      returning ${FACT_REVIEW_QUEUE_COLUMNS}`,
    [reviewId, candidate, reviewerId, reviewedAt, factId],
  );
  if (rows.length !== 1) {
    throw new Error("fact review queue item was not found or is no longer queued");
  }
  return factReviewQueueRowFromDb(rows[0]);
}

async function updateFactReviewAsRejected(
  db: QueryExecutor,
  reviewId: string,
  reviewerId: string,
  reviewedAt: string,
): Promise<FactReviewQueueRow> {
  const { rows } = await db.query<FactReviewQueueDbRow>(
    `update fact_review_queue
        set status = 'dismissed',
            reviewed_by = $2,
            reviewed_at = $3,
            updated_at = now()
      where review_id = $1
        and status = 'queued'
      returning ${FACT_REVIEW_QUEUE_COLUMNS}`,
    [reviewId, reviewerId, reviewedAt],
  );
  if (rows.length !== 1) {
    throw new Error("fact review queue item was not found or is no longer queued");
  }
  return factReviewQueueRowFromDb(rows[0]);
}

async function updateFactReviewCandidate(
  db: QueryExecutor,
  reviewId: string,
  candidate: NormalizedFactInput,
): Promise<FactReviewQueueRow> {
  const { rows } = await db.query<FactReviewQueueDbRow>(
    `update fact_review_queue
        set candidate = $2::jsonb,
            source_id = $3,
            metric_id = $4,
            confidence = $5,
            updated_at = now()
      where review_id = $1
        and status = 'queued'
      returning ${FACT_REVIEW_QUEUE_COLUMNS}`,
    [reviewId, candidate, candidate.source_id, candidate.metric_id, candidate.confidence],
  );
  if (rows.length !== 1) {
    throw new Error("fact review queue item was not found or is no longer queued");
  }
  return factReviewQueueRowFromDb(rows[0]);
}

async function insertFactReviewAction(
  db: QueryExecutor,
  input: Omit<FactReviewActionRow, "action_id" | "created_at">,
): Promise<FactReviewActionRow> {
  const { rows } = await db.query<FactReviewActionDbRow>(
    `insert into fact_review_actions
       (review_id,
        action,
        reviewer_id,
        notes,
        candidate_before,
        candidate_after,
        fact_id)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
     returning ${FACT_REVIEW_ACTION_COLUMNS}`,
    [
      input.review_id,
      input.action,
      input.reviewer_id,
      input.notes,
      input.candidate_before,
      input.candidate_after,
      input.fact_id,
    ],
  );
  return factReviewActionRowFromDb(rows[0]);
}

async function assertReviewerThroughputAvailable(
  db: QueryExecutor,
  reviewerId: string,
  limit: FactReviewThroughputLimit | undefined,
): Promise<void> {
  if (limit == null) return;
  assertPositiveIntegerInRange(limit.max_actions, "throughput_limit.max_actions", 1, 1_000);
  assertPositiveIntegerInRange(limit.window_seconds, "throughput_limit.window_seconds", 1, 30 * 24 * 60 * 60);
  await db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [reviewerId]);
  const { rows } = await db.query<{ action_count: number | string }>(
    `select count(*)::int as action_count
       from fact_review_actions
      where reviewer_id = $1
        and created_at >= now() - ($2 * interval '1 second')`,
    [reviewerId, limit.window_seconds],
  );
  const actionCount = Number(rows[0]?.action_count ?? 0);
  if (actionCount >= limit.max_actions) {
    throw new FactReviewThroughputExceededError({
      reviewer_id: reviewerId,
      max_actions: limit.max_actions,
      window_seconds: limit.window_seconds,
    });
  }
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

function assertReviewActionInput(reviewId: string, reviewerId: string, reviewedAt: string | undefined): void {
  assertUuidV4(reviewId, "review_id");
  assertNonEmptyString(reviewerId, "reviewer_id");
  if (reviewedAt != null) assertIso8601WithOffset(reviewedAt, "reviewed_at");
}

function normalizeOptionalNotes(notes: string | null | undefined): string | null {
  if (notes == null) return null;
  assertOptionalNonEmptyString(notes, "notes");
  return notes;
}

function normalizeReviewCandidate(input: FactInput): NormalizedFactInput {
  return {
    ...normalizeFactInput(input),
    verification_status: "candidate" as const,
  };
}

function reviewProvenanceFlag(input: {
  action: "approved";
  review_id: string;
  reviewer_id: string;
  reviewed_at: string;
}): Readonly<Record<string, string>> {
  return Object.freeze({
    kind: "manual_review",
    action: input.action,
    review_id: input.review_id,
    reviewer_id: input.reviewer_id,
    reviewed_at: input.reviewed_at,
  });
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
    throw new Error("fact review queue operation did not return a row");
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
    reviewed_by: row.reviewed_by,
    reviewed_at: nullableIsoString(row.reviewed_at),
    fact_id: row.fact_id,
  });
}

function factReviewActionRowFromDb(row: FactReviewActionDbRow | undefined): FactReviewActionRow {
  if (!row) {
    throw new Error("fact review action insert did not return a row");
  }
  assertOneOf(row.action, FACT_REVIEW_ACTIONS, "action");
  return Object.freeze({
    action_id: row.action_id,
    review_id: row.review_id,
    action: row.action,
    reviewer_id: row.reviewer_id,
    notes: row.notes,
    candidate_before: row.candidate_before,
    candidate_after: row.candidate_after,
    fact_id: row.fact_id,
    created_at: isoString(row.created_at),
  });
}

function staleFactReviewQueueRowFromDb(row: StaleFactReviewQueueDbRow | undefined): StaleFactReviewQueueRow {
  if (!row) {
    throw new Error("stale fact review queue operation did not return a row");
  }
  return Object.freeze({
    ...factReviewQueueRowFromDb(row),
    age_seconds: Number(row.age_seconds),
    stale_after_seconds: Number(row.stale_after_seconds),
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

function assertPositiveIntegerInRange(value: unknown, label: string, min: number, max: number): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label}: must be an integer between ${min} and ${max}`);
  }
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
  return (
    typeof (value as Partial<FactClientPool>).connect === "function" &&
    typeof (value as Partial<FactPoolClient>).release !== "function"
  );
}

function nullableIsoString(value: Date | string | null): string | null {
  return value == null ? null : isoString(value);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
