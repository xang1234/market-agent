import { createDocument, type DocumentInput, type DocumentRow } from "./document-repo.ts";
import { decideStoragePolicy, type StoragePolicy } from "./license-policy.ts";
import {
  type ObjectStore,
  contentHashFromBytes,
  ephemeralRawBlobIdForSource,
} from "./object-store.ts";
import type { QueryExecutor } from "./types.ts";

export type IngestDocumentDeps = {
  db: QueryExecutor;
  objectStore: ObjectStore;
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
    const put = await deps.objectStore.put(input.bytes);
    raw_blob_id = put.blob.raw_blob_id;
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
