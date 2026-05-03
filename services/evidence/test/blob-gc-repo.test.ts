import test from "node:test";
import assert from "node:assert/strict";

import {
  createObjectBlobGcWorker,
  deleteUserAndQueueObjectBlobs,
  deleteUserAndQueueObjectBlobsWithPool,
  objectBlobGcTransactionClient,
  runObjectBlobGcBatch,
  runObjectBlobGcBatchWithPool,
} from "../src/blob-gc-repo.ts";
import {
  rawBlobIdFromBytes,
  type ObjectStore,
  type PutResult,
  type StoredBlob,
} from "../src/object-store.ts";
import type { QueryExecutor } from "../src/types.ts";

type Query = { text: string; values?: unknown[] };

const USER_ID = "11111111-1111-4111-a111-111111111111";
const STORED_BLOB_ID = rawBlobIdFromBytes(new TextEncoder().encode("stored"));
const SHARED_BLOB_ID = rawBlobIdFromBytes(new TextEncoder().encode("shared"));

class FakeDb implements QueryExecutor {
  readonly queries: Query[] = [];
  readonly queued = new Set<string>();
  readonly referenced = new Set<string>();
  readonly deferred = new Set<string>();
  readonly deletedQueueRows = new Set<string>();
  readonly releaseArgs: boolean[] = [];
  released = false;

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) {
    this.queries.push({ text, values });

    if (/insert into object_blob_gc_queue/i.test(text)) {
      for (const rawBlobId of [STORED_BLOB_ID, SHARED_BLOB_ID]) {
        this.queued.add(rawBlobId);
        this.deletedQueueRows.delete(rawBlobId);
      }
      return { rows: [{ raw_blob_id: STORED_BLOB_ID }, { raw_blob_id: SHARED_BLOB_ID }] as R[], rowCount: 2 } as never;
    }
    if (/delete from users/i.test(text)) {
      return { rows: [{ user_id: values?.[0] }] as R[], rowCount: 1 } as never;
    }
    if (/from object_blob_gc_queue/i.test(text) && /for update skip locked/i.test(text)) {
      const limit = values?.[0] as number;
      return {
        rows: Array.from(this.queued)
          .filter((raw_blob_id) => !this.deferred.has(raw_blob_id))
          .slice(0, limit)
          .map((raw_blob_id) => ({ raw_blob_id })) as R[],
        rowCount: this.queued.size,
      } as never;
    }
    if (/pg_advisory_xact_lock/i.test(text)) {
      return { rows: [], rowCount: 1 } as never;
    }
    if (/select exists/i.test(text) && /from documents/i.test(text)) {
      return { rows: [{ referenced: this.referenced.has(values?.[0] as string) }] as R[], rowCount: 1 } as never;
    }
    if (/set deleted_at = now\(\)/i.test(text)) {
      this.queued.delete(values?.[0] as string);
      this.deletedQueueRows.add(values?.[0] as string);
      return { rows: [], rowCount: 1 } as never;
    }
    if (/next_attempt_at = now\(\) \+ /i.test(text)) {
      this.deferred.add(values?.[0] as string);
      return { rows: [], rowCount: 1 } as never;
    }
    if (/set attempts = attempts \+ 1/i.test(text)) {
      return { rows: [], rowCount: 1 } as never;
    }
    return { rows: [], rowCount: 0 } as never;
  }

  release(destroy = false): void {
    this.releaseArgs.push(destroy);
    this.released = true;
  }
}

class RecordingDeleteObjectStore implements ObjectStore {
  readonly deleted: string[] = [];

  async put(): Promise<PutResult> {
    throw new Error("put should not be called");
  }

  async get(): Promise<StoredBlob | null> {
    throw new Error("get should not be called");
  }

  async has(): Promise<boolean> {
    throw new Error("has should not be called");
  }

  async delete(rawBlobId: string): Promise<boolean> {
    this.deleted.push(rawBlobId);
    return true;
  }
}

class FailingOnceObjectStore extends RecordingDeleteObjectStore {
  readonly failRawBlobId: string;

  constructor(failRawBlobId: string) {
    super();
    this.failRawBlobId = failRawBlobId;
  }

  override async delete(rawBlobId: string): Promise<boolean> {
    if (rawBlobId === this.failRawBlobId) {
      throw new Error("delete failed");
    }
    return super.delete(rawBlobId);
  }
}

test("deleteUserAndQueueObjectBlobs queues sha256 user document blobs before deleting the user", async () => {
  const db = new FakeDb();

  const result = await deleteUserAndQueueObjectBlobs(objectBlobGcTransactionClient(db), USER_ID);

  assert.deepEqual(result.queued_raw_blob_ids, [STORED_BLOB_ID, SHARED_BLOB_ID]);
  assert.equal(result.deleted_user, true);
  assert.match(db.queries[0].text, /^begin$/i);
  assert.match(db.queries[1].text, /from users where user_id = \$1 for update/i);
  assert.match(db.queries[2].text, /from sources where user_id = \$1 for update/i);
  assert.match(db.queries[3].text, /insert into object_blob_gc_queue/i);
  assert.match(db.queries[3].text, /join sources/i);
  assert.match(db.queries[3].text, /sources\.user_id = \$1/i);
  assert.match(db.queries[3].text, /raw_blob_id ~ '\^sha256:\[0-9a-f\]\{64\}\$'/i);
  assert.match(db.queries[3].text, /deleted_at = null/i);
  assert.match(db.queries[4].text, /delete from users where user_id = \$1/i);
  assert.match(db.queries.at(-1)?.text ?? "", /^commit$/i);
});

test("deleteUserAndQueueObjectBlobs revives a previously deleted tombstone on requeue", async () => {
  const db = new FakeDb();
  db.deletedQueueRows.add(STORED_BLOB_ID);

  await deleteUserAndQueueObjectBlobs(objectBlobGcTransactionClient(db), USER_ID);

  assert.equal(db.deletedQueueRows.has(STORED_BLOB_ID), false);
  assert.match(
    db.queries.find((query) => /on conflict \(raw_blob_id\)/i.test(query.text))?.text ?? "",
    /deleted_at = null/i,
  );
});

test("runObjectBlobGcBatch deletes only unreferenced queued blobs and leaves shared blobs queued", async () => {
  const db = new FakeDb();
  db.queued.add(STORED_BLOB_ID);
  db.queued.add(SHARED_BLOB_ID);
  db.referenced.add(SHARED_BLOB_ID);
  const objectStore = new RecordingDeleteObjectStore();

  const result = await runObjectBlobGcBatch(objectBlobGcTransactionClient(db), objectStore, { limit: 10 });

  assert.deepEqual(result.deleted_raw_blob_ids, [STORED_BLOB_ID]);
  assert.deepEqual(result.skipped_referenced_raw_blob_ids, [SHARED_BLOB_ID]);
  assert.deepEqual(objectStore.deleted, [STORED_BLOB_ID]);
  assert.equal(db.queued.has(STORED_BLOB_ID), false);
  assert.equal(db.queued.has(SHARED_BLOB_ID), true);
  assert.equal(db.deferred.has(SHARED_BLOB_ID), true);
  assert.equal(db.queries.filter((query) => /pg_advisory_xact_lock/i.test(query.text)).length, 2);
});

test("blob GC helpers reject invalid input before querying", async () => {
  const db = new FakeDb();
  const objectStore = new RecordingDeleteObjectStore();
  const client = objectBlobGcTransactionClient(db);

  await assert.rejects(deleteUserAndQueueObjectBlobs(client, "not-a-uuid"), /user_id/);
  await assert.rejects(runObjectBlobGcBatch(client, objectStore, { limit: 0 }), /limit/);
  assert.equal(db.queries.length, 0);
});

test("pool helpers acquire one client and release it", async () => {
  const queueClient = new FakeDb();
  const gcClient = new FakeDb();
  gcClient.queued.add(STORED_BLOB_ID);
  const objectStore = new RecordingDeleteObjectStore();

  const queuePool = { connect: async () => queueClient };
  const gcPool = { connect: async () => gcClient };

  await deleteUserAndQueueObjectBlobsWithPool(queuePool, USER_ID);
  await runObjectBlobGcBatchWithPool(gcPool, objectStore, { limit: 1 });

  assert.equal(queueClient.released, true);
  assert.equal(gcClient.released, true);
  assert.deepEqual(queueClient.releaseArgs, [false]);
  assert.deepEqual(gcClient.releaseArgs, [false]);
  assert.deepEqual(objectStore.deleted, [STORED_BLOB_ID]);
});

test("pool helpers destroy clients after errors", async () => {
  const queueClient = new FakeDb();
  const gcClient = new FakeDb();
  const objectStore = new RecordingDeleteObjectStore();

  await assert.rejects(
    deleteUserAndQueueObjectBlobsWithPool({ connect: async () => queueClient }, "not-a-uuid"),
    /user_id/,
  );
  await assert.rejects(
    runObjectBlobGcBatchWithPool({ connect: async () => gcClient }, objectStore, { limit: 0 }),
    /limit/,
  );

  assert.deepEqual(queueClient.releaseArgs, [true]);
  assert.deepEqual(gcClient.releaseArgs, [true]);
});

test("runObjectBlobGcBatch defers referenced blobs so later unreferenced blobs can be collected", async () => {
  const db = new FakeDb();
  db.queued.add(SHARED_BLOB_ID);
  db.queued.add(STORED_BLOB_ID);
  db.referenced.add(SHARED_BLOB_ID);
  const objectStore = new RecordingDeleteObjectStore();
  const client = objectBlobGcTransactionClient(db);

  const first = await runObjectBlobGcBatch(client, objectStore, { limit: 1, referencedRetryAfterMs: 60_000 });
  const second = await runObjectBlobGcBatch(client, objectStore, { limit: 1, referencedRetryAfterMs: 60_000 });

  assert.deepEqual(first.skipped_referenced_raw_blob_ids, [SHARED_BLOB_ID]);
  assert.deepEqual(second.deleted_raw_blob_ids, [STORED_BLOB_ID]);
  assert.deepEqual(objectStore.deleted, [STORED_BLOB_ID]);
});

test("runObjectBlobGcBatch defers failed deletes so later unreferenced blobs can be collected", async () => {
  const db = new FakeDb();
  db.queued.add(SHARED_BLOB_ID);
  db.queued.add(STORED_BLOB_ID);
  const objectStore = new FailingOnceObjectStore(SHARED_BLOB_ID);
  const client = objectBlobGcTransactionClient(db);

  const first = await runObjectBlobGcBatch(client, objectStore, { limit: 1, failureRetryAfterMs: 60_000 });
  const second = await runObjectBlobGcBatch(client, objectStore, { limit: 1, failureRetryAfterMs: 60_000 });

  assert.deepEqual(first.failed_raw_blob_ids, [SHARED_BLOB_ID]);
  assert.deepEqual(second.deleted_raw_blob_ids, [STORED_BLOB_ID]);
  assert.deepEqual(objectStore.deleted, [STORED_BLOB_ID]);
  assert.equal(db.deferred.has(SHARED_BLOB_ID), true);
});

test("object blob GC worker exposes a production polling path", async () => {
  const client = new FakeDb();
  client.queued.add(STORED_BLOB_ID);
  const objectStore = new RecordingDeleteObjectStore();
  const worker = createObjectBlobGcWorker({
    pool: { connect: async () => client },
    objectStore,
    intervalMs: 1_000,
    limit: 1,
  });

  const result = await worker.runOnce();
  worker.start();
  worker.start();
  worker.stop();
  worker.stop();

  assert.deepEqual(result.deleted_raw_blob_ids, [STORED_BLOB_ID]);
  assert.deepEqual(objectStore.deleted, [STORED_BLOB_ID]);
  assert.equal(client.released, true);
});
