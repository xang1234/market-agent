import { assertRawBlobId, type ObjectStore } from "./object-store.ts";
import type { QueryExecutor } from "./types.ts";
import { assertUuidV4 } from "./validators.ts";

const OBJECT_BLOB_GC_TRANSACTION_CLIENT: unique symbol = Symbol("evidence.objectBlobGcTransactionClient");
const DEFAULT_REFERENCED_RETRY_AFTER_MS = 60_000;
const DEFAULT_FAILURE_RETRY_AFTER_MS = 60_000;

type ObjectBlobGcTransactionClientBrand = {
  readonly [OBJECT_BLOB_GC_TRANSACTION_CLIENT]: true;
};

export type ObjectBlobGcPoolClient = QueryExecutor & {
  release(error?: Error): void;
};

export type ObjectBlobGcTransactionClient = ObjectBlobGcPoolClient & ObjectBlobGcTransactionClientBrand;

export type ObjectBlobGcClientPool = {
  connect(): Promise<ObjectBlobGcPoolClient>;
};

export type DeleteUserBlobQueueResult = Readonly<{
  queued_raw_blob_ids: readonly string[];
  deleted_user: boolean;
}>;

export type ObjectBlobGcBatchResult = Readonly<{
  deleted_raw_blob_ids: readonly string[];
  skipped_referenced_raw_blob_ids: readonly string[];
  failed_raw_blob_ids: readonly string[];
}>;

export type ObjectBlobGcBatchOptions = Readonly<{
  limit?: number;
  referencedRetryAfterMs?: number;
  failureRetryAfterMs?: number;
}>;

export type ObjectBlobGcWorker = Readonly<{
  runOnce(): Promise<ObjectBlobGcBatchResult>;
  start(): void;
  stop(): void;
}>;

export type ObjectBlobGcWorkerConfig = Readonly<{
  pool: ObjectBlobGcClientPool;
  objectStore: ObjectStore;
  intervalMs?: number;
  limit?: number;
  referencedRetryAfterMs?: number;
  failureRetryAfterMs?: number;
  onError?(error: unknown): void;
}>;

type RawBlobRow = { raw_blob_id: string };
type ReferencedRow = { referenced: boolean };

export function objectBlobGcTransactionClient<T extends QueryExecutor>(
  client: T,
): T & ObjectBlobGcTransactionClient {
  if ((client as Partial<ObjectBlobGcTransactionClientBrand>)[OBJECT_BLOB_GC_TRANSACTION_CLIENT] === true) {
    return client as T & ObjectBlobGcTransactionClient;
  }
  if (isPoolLike(client)) {
    throw new Error("object blob GC requires a pinned transaction client; use the WithPool helpers for pools");
  }
  Object.defineProperty(client, OBJECT_BLOB_GC_TRANSACTION_CLIENT, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return client as T & ObjectBlobGcTransactionClient;
}

export async function deleteUserAndQueueObjectBlobs(
  db: ObjectBlobGcTransactionClient,
  userId: string,
): Promise<DeleteUserBlobQueueResult> {
  assertObjectBlobGcTransactionClient(db);
  assertUuidV4(userId, "user_id");

  await db.query("begin");
  try {
    await lockUserBlobScope(db, userId);
    const queued = await db.query<RawBlobRow>(
      `insert into object_blob_gc_queue (raw_blob_id, reason, source_user_id)
       select distinct documents.raw_blob_id, 'user_erasure', sources.user_id
         from documents
         join sources on sources.source_id = documents.source_id
        where sources.user_id = $1
          and documents.raw_blob_id ~ '^sha256:[0-9a-f]{64}$'
       on conflict (raw_blob_id) do update
             set queued_at = least(object_blob_gc_queue.queued_at, excluded.queued_at),
                 next_attempt_at = least(object_blob_gc_queue.next_attempt_at, excluded.next_attempt_at),
                 source_user_id = coalesce(object_blob_gc_queue.source_user_id, excluded.source_user_id),
                 deleted_at = null,
                 last_checked_at = null,
                 last_error = null,
                 updated_at = now()
       returning raw_blob_id`,
      [userId],
    );
    const deleted = await db.query<{ user_id: string }>(
      `delete from users where user_id = $1 returning user_id`,
      [userId],
    );
    await db.query("commit");
    return Object.freeze({
      queued_raw_blob_ids: Object.freeze(queued.rows.map((row) => row.raw_blob_id)),
      deleted_user: deleted.rowCount === 1,
    });
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export async function deleteUserAndQueueObjectBlobsWithPool(
  pool: ObjectBlobGcClientPool,
  userId: string,
): Promise<DeleteUserBlobQueueResult> {
  const client = await pool.connect();
  try {
    return await deleteUserAndQueueObjectBlobs(objectBlobGcTransactionClient(client), userId);
  } finally {
    client.release();
  }
}

export async function runObjectBlobGcBatch(
  db: ObjectBlobGcTransactionClient,
  objectStore: ObjectStore,
  options: ObjectBlobGcBatchOptions = {},
): Promise<ObjectBlobGcBatchResult> {
  assertObjectBlobGcTransactionClient(db);
  const limit = options.limit ?? 100;
  assertPositiveInteger(limit, "limit");
  const referencedRetryAfterMs = options.referencedRetryAfterMs ?? DEFAULT_REFERENCED_RETRY_AFTER_MS;
  assertNonNegativeInteger(referencedRetryAfterMs, "referencedRetryAfterMs");
  const failureRetryAfterMs = options.failureRetryAfterMs ?? DEFAULT_FAILURE_RETRY_AFTER_MS;
  assertNonNegativeInteger(failureRetryAfterMs, "failureRetryAfterMs");

  const deleted: string[] = [];
  const skippedReferenced: string[] = [];
  const failed: string[] = [];

  await db.query("begin");
  try {
    const pending = await db.query<RawBlobRow>(
      `select raw_blob_id
         from object_blob_gc_queue
        where deleted_at is null
          and next_attempt_at <= now()
        order by next_attempt_at, queued_at, raw_blob_id
        limit $1
        for update skip locked`,
      [limit],
    );

    for (const row of pending.rows) {
      const rawBlobId = row.raw_blob_id;
      assertRawBlobId(rawBlobId);
      await lockRawBlobId(db, rawBlobId);

      if (await blobStillReferenced(db, rawBlobId)) {
        await markReferencedForRetry(db, rawBlobId, referencedRetryAfterMs);
        skippedReferenced.push(rawBlobId);
        continue;
      }

      try {
        await objectStore.delete(rawBlobId);
        await db.query(
          `update object_blob_gc_queue
              set deleted_at = now(),
                  attempts = attempts + 1,
                  last_checked_at = now(),
                  last_error = null,
                  updated_at = now()
            where raw_blob_id = $1`,
          [rawBlobId],
        );
        deleted.push(rawBlobId);
      } catch (error) {
        failed.push(rawBlobId);
        await db.query(
          `update object_blob_gc_queue
              set attempts = attempts + 1,
                  last_checked_at = now(),
                  next_attempt_at = now() + ($2::integer * interval '1 millisecond'),
                  last_error = $3,
                  updated_at = now()
            where raw_blob_id = $1`,
          [rawBlobId, failureRetryAfterMs, errorMessage(error)],
        );
      }
    }

    await db.query("commit");
    return Object.freeze({
      deleted_raw_blob_ids: Object.freeze(deleted),
      skipped_referenced_raw_blob_ids: Object.freeze(skippedReferenced),
      failed_raw_blob_ids: Object.freeze(failed),
    });
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export async function runObjectBlobGcBatchWithPool(
  pool: ObjectBlobGcClientPool,
  objectStore: ObjectStore,
  options: ObjectBlobGcBatchOptions = {},
): Promise<ObjectBlobGcBatchResult> {
  const client = await pool.connect();
  try {
    return await runObjectBlobGcBatch(objectBlobGcTransactionClient(client), objectStore, options);
  } finally {
    client.release();
  }
}

export function createObjectBlobGcWorker(config: ObjectBlobGcWorkerConfig): ObjectBlobGcWorker {
  const intervalMs = config.intervalMs ?? 60_000;
  assertPositiveInteger(intervalMs, "intervalMs");
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function runOnce(): Promise<ObjectBlobGcBatchResult> {
    return runObjectBlobGcBatchWithPool(config.pool, config.objectStore, {
      limit: config.limit,
      referencedRetryAfterMs: config.referencedRetryAfterMs,
      failureRetryAfterMs: config.failureRetryAfterMs,
    });
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch (error) {
      config.onError?.(error);
    } finally {
      running = false;
    }
  }

  return Object.freeze({
    runOnce,
    start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  });
}

async function blobStillReferenced(db: QueryExecutor, rawBlobId: string): Promise<boolean> {
  const result = await db.query<ReferencedRow>(
    `select exists (
       select 1
         from documents
        where raw_blob_id = $1
     ) as referenced`,
    [rawBlobId],
  );
  return result.rows[0]?.referenced === true;
}

async function lockUserBlobScope(db: QueryExecutor, userId: string): Promise<void> {
  await db.query(`select user_id from users where user_id = $1 for update`, [userId]);
  await db.query(`select source_id from sources where user_id = $1 for update`, [userId]);
}

async function lockRawBlobId(db: QueryExecutor, rawBlobId: string): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [rawBlobId]);
}

async function markReferencedForRetry(
  db: QueryExecutor,
  rawBlobId: string,
  referencedRetryAfterMs: number,
): Promise<void> {
  await db.query(
    `update object_blob_gc_queue
        set attempts = attempts + 1,
            last_checked_at = now(),
            next_attempt_at = now() + ($2::integer * interval '1 millisecond'),
            updated_at = now()
      where raw_blob_id = $1`,
    [rawBlobId, referencedRetryAfterMs],
  );
}

function assertObjectBlobGcTransactionClient(
  db: QueryExecutor,
): asserts db is ObjectBlobGcTransactionClient {
  if ((db as Partial<ObjectBlobGcTransactionClientBrand>)[OBJECT_BLOB_GC_TRANSACTION_CLIENT] !== true) {
    throw new Error("object blob GC requires a pinned transaction client");
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${label}: must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label}: must be a non-negative integer`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPoolLike(db: QueryExecutor): boolean {
  return typeof (db as { connect?: unknown }).connect === "function" && typeof (db as { release?: unknown }).release !== "function";
}
