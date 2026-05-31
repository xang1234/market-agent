import { createDocument, type DocumentInput, type DocumentRow } from "./document-repo.ts";
import { decideStoragePolicy, type StoragePolicy } from "./license-policy.ts";
import {
  type ObjectStore,
  contentHashFromBytes,
  ephemeralRawBlobIdForSource,
  rawBlobIdFromBytes,
} from "./object-store.ts";
import {
  assertTransactionContext,
  type TransactionContext,
  withTransaction,
} from "./transaction.ts";
import type { QueryExecutor } from "./types.ts";

export type IngestDocumentDeps = {
  db: QueryExecutor;
  objectStore: ObjectStore;
};

export type IngestDocumentTransactionDeps = {
  tx: TransactionContext;
  objectStore: ObjectStore;
};

export type IngestDocumentPoolClient = QueryExecutor & {
  release(destroy?: boolean): void;
};

export type IngestDocumentClientPool = {
  connect(): Promise<IngestDocumentPoolClient>;
};

export type IngestDocumentInput = {
  source: {
    source_id: string;
    license_class: string;
  };
  bytes: Uint8Array;
  document: Omit<DocumentInput, "source_id" | "content_hash" | "raw_blob_id">;
};

export type IngestDocumentResult = {
  status: "blob_stored" | "ephemeral";
  document: DocumentRow;
  raw_blob_id: string;
  policy: StoragePolicy;
};

export async function ingestDocument(
  deps: IngestDocumentDeps,
  input: IngestDocumentInput,
): Promise<IngestDocumentResult> {
  // Decide first, before any storage or db work — fail-closed for
  // unknown license classes leaves no partial state behind.
  const policy = decideStoragePolicy(input.source.license_class);

  // Always derived from bytes, even on the ephemeral path, so the
  // documents.unique(content_hash, raw_blob_id) dedupe stays meaningful.
  const content_hash = contentHashFromBytes(input.bytes);

  let raw_blob_id: string;
  if (policy.store_blob) {
    return ingestStoredDocumentWithBlobLock(deps, input);
  } else {
    raw_blob_id = ephemeralRawBlobIdForSource(input.source.source_id);
  }

  const result = await createDocument(deps.db, {
    ...input.document,
    source_id: input.source.source_id,
    content_hash,
    raw_blob_id,
  });

  return Object.freeze({
    status: policy.store_blob ? ("blob_stored" as const) : ("ephemeral" as const),
    document: result.document,
    raw_blob_id,
    policy,
  });
}

export async function ingestDocumentInTransaction(
  deps: IngestDocumentTransactionDeps,
  input: IngestDocumentInput,
): Promise<IngestDocumentResult> {
  assertTransactionContext(deps.tx, "ingestDocumentInTransaction");
  const db = deps.tx.db;
  const policy = decideStoragePolicy(input.source.license_class);
  const content_hash = contentHashFromBytes(input.bytes);
  if (!policy.store_blob) {
    const raw_blob_id = ephemeralRawBlobIdForSource(input.source.source_id);
    const result = await createDocument(db, {
      ...input.document,
      source_id: input.source.source_id,
      content_hash,
      raw_blob_id,
    });
    return Object.freeze({
      status: "ephemeral" as const,
      document: result.document,
      raw_blob_id,
      policy,
    });
  }

  const raw_blob_id = rawBlobIdFromBytes(input.bytes);
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [raw_blob_id]);
  await lockSourceForBlobIngest(db, input.source.source_id);
  const putResult = await deps.objectStore.put(input.bytes);
  const storedRawBlobId = putResult.blob.raw_blob_id;
  let unregisterRollbackCleanup = () => {};
  if (putResult.status === "created") {
    unregisterRollbackCleanup = deps.tx.onRollback((error) =>
      deleteCreatedBlobBestEffort(deps.objectStore, storedRawBlobId, error)
    );
  }
  try {
    if (storedRawBlobId !== raw_blob_id) {
      throw new Error("ingestDocument: object store returned a blob id that does not match the input bytes");
    }
    const result = await createDocument(db, {
      ...input.document,
      source_id: input.source.source_id,
      content_hash,
      raw_blob_id,
    });
    return Object.freeze({
      status: "blob_stored" as const,
      document: result.document,
      raw_blob_id,
      policy,
    });
  } catch (error) {
    unregisterRollbackCleanup();
    if (putResult.status === "created") {
      await deleteCreatedBlobBestEffort(deps.objectStore, storedRawBlobId, error);
    }
    throw error;
  }
}

export async function ingestDocumentWithPool(
  pool: IngestDocumentClientPool,
  objectStore: ObjectStore,
  input: IngestDocumentInput,
): Promise<IngestDocumentResult> {
  const client = await pool.connect();
  let destroyClient = false;
  try {
    return await ingestDocument({ db: client, objectStore }, input);
  } catch (error) {
    destroyClient = true;
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

async function ingestStoredDocumentWithBlobLock(
  deps: IngestDocumentDeps,
  input: IngestDocumentInput,
): Promise<IngestDocumentResult> {
  return withTransaction(deps.db, (tx) =>
    ingestDocumentInTransaction({ objectStore: deps.objectStore, tx }, input)
  );
}

async function deleteCreatedBlobBestEffort(
  objectStore: ObjectStore,
  rawBlobId: string,
  originalError: unknown,
): Promise<void> {
  try {
    await objectStore.delete(rawBlobId);
  } catch (deleteError) {
    if (originalError instanceof Error) {
      (originalError as { cleanup_error?: unknown }).cleanup_error = deleteError;
    }
  }
}

async function lockSourceForBlobIngest(db: QueryExecutor, sourceId: string): Promise<void> {
  const result = await db.query<{ source_id: string }>(
    `select source_id::text as source_id
       from sources
      where source_id = $1::uuid
      for key share`,
    [sourceId],
  );
  if (result.rowCount !== 1) {
    throw new Error("ingestDocument: source does not exist or is being erased");
  }
}
