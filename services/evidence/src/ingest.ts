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
import { withPoolClient } from "../../shared/src/pool-client.ts";
import { SEC_UUENCODED_BODIES_REMOVED, stripUuencodedBodies } from "./sec-submission-strip.ts";

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

  // A filing's uuencoded attachments are not stored (#757); content_hash still
  // names the bytes as sent.
  const stripped = input.document.kind === "filing" ? stripUuencodedBodies(input.bytes) : null;
  const storedBytes = stripped ?? input.bytes;
  const raw_blob_id = rawBlobIdFromBytes(storedBytes);
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [raw_blob_id]);
  await lockSourceForBlobIngest(db, input.source.source_id);
  // content_hash is the filing's identity, whatever blob holds it. A public
  // filing of this provider stored as sent (before #757, or kept whole for an
  // offset that cites it) is the document these bytes name, unless one is
  // stored stripped. A user's upload or another kind's document with the same
  // bytes never is. The rewrite moves it only under the lock held.
  if (stripped !== null) {
    const { rows: [sent] } = await db.query(
      `select 1
         from documents d
         join sources s on s.source_id = d.source_id
         join sources mine on mine.source_id = $3::uuid
        where d.content_hash = $1 and d.raw_blob_id = $1 and d.kind = 'filing'
          and s.user_id is null and mine.user_id is null
          and s.provider = mine.provider and s.license_class = mine.license_class
          and not exists (select 1 from documents x where x.content_hash = $1 and x.raw_blob_id = $2)
          for share of d`,
      [content_hash, raw_blob_id, input.source.source_id],
    );
    if (sent !== undefined) {
      const result = await createDocument(db, { ...input.document, source_id: input.source.source_id, content_hash, raw_blob_id: content_hash });
      return Object.freeze({ status: "blob_stored" as const, document: result.document, raw_blob_id: content_hash, policy });
    }
  }
  const putResult = await deps.objectStore.put(storedBytes);
  const storedRawBlobId = putResult.blob.raw_blob_id;
  if (putResult.status === "created") {
    deps.tx.onRollback((error) => deleteBlobIfUnnamed(db, deps.objectStore, storedRawBlobId, error));
  }
  if (storedRawBlobId !== raw_blob_id) {
    throw new Error("ingestDocument: object store returned a blob id that does not match the input bytes");
  }
  const result = await createDocument(db, {
    ...input.document,
    source_id: input.source.source_id,
    content_hash,
    raw_blob_id,
    raw_blob_transform: stripped === null ? null : SEC_UUENCODED_BODIES_REMOVED,
  });
  return Object.freeze({
    status: "blob_stored" as const,
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
  return withPoolClient(pool, (client) => ingestDocument({ db: client, objectStore }, input), () => true);
}

async function ingestStoredDocumentWithBlobLock(
  deps: IngestDocumentDeps,
  input: IngestDocumentInput,
): Promise<IngestDocumentResult> {
  return withTransaction(deps.db, (tx) =>
    ingestDocumentInTransaction({ objectStore: deps.objectStore, tx }, input)
  );
}

// Deletes a blob a rolled-back transaction created, as the GC would: under the
// blob's lock and only while no document names it. Postgres frees that
// transaction's locks when a statement fails, before its rollback, so another
// ingest may have named the blob since. Run after the transaction ends.
export async function deleteBlobIfUnnamed(
  db: QueryExecutor,
  objectStore: ObjectStore,
  rawBlobId: string,
  originalError: unknown,
): Promise<void> {
  try {
    await withTransaction(db, async (tx) => {
      await tx.db.query("select pg_advisory_xact_lock(hashtext($1))", [rawBlobId]);
      const named = await tx.db.query("select 1 from documents where raw_blob_id = $1 limit 1", [rawBlobId]);
      if (named.rowCount === 0) await objectStore.delete(rawBlobId);
    });
  } catch (cleanupError) {
    if (originalError instanceof Error) {
      (originalError as { cleanup_error?: unknown }).cleanup_error = cleanupError;
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
