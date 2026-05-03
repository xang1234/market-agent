import { createDocument, type DocumentInput, type DocumentRow } from "./document-repo.ts";
import { decideStoragePolicy, type StoragePolicy } from "./license-policy.ts";
import {
  type ObjectStore,
  type PutResult,
  contentHashFromBytes,
  ephemeralRawBlobIdForSource,
  rawBlobIdFromBytes,
} from "./object-store.ts";
import type { QueryExecutor } from "./types.ts";

export type IngestDocumentDeps = {
  db: QueryExecutor;
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
    raw_blob_id = rawBlobIdFromBytes(input.bytes);
    return ingestStoredDocumentWithBlobLock(deps, input, policy, content_hash, raw_blob_id);
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
  policy: StoragePolicy,
  content_hash: string,
  raw_blob_id: string,
): Promise<IngestDocumentResult> {
  if (isPgPoolLike(deps.db)) {
    throw new Error("ingestDocument requires a pinned database client for stored blobs; use ingestDocumentWithPool for pools");
  }
  let putResult: PutResult | null = null;
  let commitAttempted = false;
  await deps.db.query("begin");
  try {
    await deps.db.query("select pg_advisory_xact_lock(hashtext($1))", [raw_blob_id]);
    await lockSourceForBlobIngest(deps.db, input.source.source_id);
    putResult = await deps.objectStore.put(input.bytes);
    if (putResult.blob.raw_blob_id !== raw_blob_id) {
      throw new Error("ingestDocument: object store returned a blob id that does not match the input bytes");
    }
    const result = await createDocument(deps.db, {
      ...input.document,
      source_id: input.source.source_id,
      content_hash,
      raw_blob_id,
    });
    commitAttempted = true;
    await deps.db.query("commit");
    return Object.freeze({
      status: "blob_stored" as const,
      document: result.document,
      raw_blob_id,
      policy,
    });
  } catch (error) {
    if (!commitAttempted && putResult?.status === "created") {
      await deleteCreatedBlobBestEffort(deps.objectStore, raw_blob_id, error);
    }
    if (!commitAttempted) {
      await deps.db.query("rollback");
    }
    throw error;
  }
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

function isPgPoolLike(db: QueryExecutor): boolean {
  const candidate = db as {
    connect?: unknown;
    totalCount?: unknown;
    idleCount?: unknown;
  };
  return (
    typeof candidate.connect === "function" &&
    typeof candidate.totalCount === "number" &&
    typeof candidate.idleCount === "number"
  );
}
