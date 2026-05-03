// User-scoped uploads (PDFs, notes).
//
// Wraps createSource + ingestDocument with the upload-specific defaults
// (provider/kind/trust/license) and stamps the source with user_id so
// every documents row pointing at it inherits visibility scope through
// the source FK. Query helpers enforce that scope at the SQL layer —
// callers cannot accidentally leak a row by forgetting a JS filter.

import {
  DOCUMENT_KINDS,
  type DocumentRow,
  type ParseStatus,
} from "./document-repo.ts";
import { ingestDocument, type IngestDocumentResult } from "./ingest.ts";
import type { ObjectStore } from "./object-store.ts";
import { createSource, type SourceRow } from "./source-repo.ts";
import type { QueryExecutor } from "./types.ts";
import { assertNonEmptyBytes, assertUuidV4 } from "./validators.ts";

export const USER_UPLOAD_PROVIDER = "user_upload";
export const USER_UPLOAD_LICENSE_CLASS = "user_private";

export type IngestUserUploadDeps = {
  db: QueryExecutor;
  objectStore: ObjectStore;
};

export type IngestUserUploadInput = {
  userId: string;
  bytes: Uint8Array;
  title: string;
  // Original filename or content-type — not load-bearing, just helpful
  // breadcrumb for downstream UIs that want to render the upload.
  contentType?: string | null;
  retrievedAt?: string;
};

export type IngestUserUploadResult = {
  source: SourceRow;
  ingest: IngestDocumentResult;
};

export async function ingestUserUpload(
  deps: IngestUserUploadDeps,
  input: IngestUserUploadInput,
): Promise<IngestUserUploadResult> {
  assertUuidV4(input.userId, "user_id");
  assertNonEmptyBytes(input.bytes, "bytes");

  const retrievedAt = input.retrievedAt ?? new Date().toISOString();
  const source = await createSource(deps.db, {
    provider: USER_UPLOAD_PROVIDER,
    kind: "upload",
    trust_tier: "user",
    license_class: USER_UPLOAD_LICENSE_CLASS,
    retrieved_at: retrievedAt,
    user_id: input.userId,
  });

  const ingest = await ingestDocument(
    { db: deps.db, objectStore: deps.objectStore },
    {
      source: { source_id: source.source_id, license_class: source.license_class },
      bytes: input.bytes,
      document: {
        kind: "upload",
        title: input.title,
      },
    },
  );

  return Object.freeze({ source, ingest });
}

const DOCUMENT_COLUMNS_QUALIFIED = `documents.document_id,
       documents.source_id,
       documents.provider_doc_id,
       documents.kind,
       documents.parent_document_id,
       documents.conversation_id,
       documents.title,
       documents.author,
       documents.published_at,
       documents.lang,
       documents.content_hash,
       documents.raw_blob_id,
       documents.parse_status,
       documents.deleted_at,
       documents.created_at,
       documents.updated_at`;

type DocumentDbRow = Omit<
  DocumentRow,
  "published_at" | "deleted_at" | "created_at" | "updated_at"
> & {
  published_at: Date | string | null;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export async function listUserUploadDocuments(
  db: QueryExecutor,
  userId: string,
): Promise<readonly DocumentRow[]> {
  assertUuidV4(userId, "user_id");

  const { rows } = await db.query<DocumentDbRow>(
    `select ${DOCUMENT_COLUMNS_QUALIFIED}
       from documents
       join sources on sources.source_id = documents.source_id
      where sources.user_id = $1
        and sources.kind = 'upload'
        and documents.deleted_at is null
      order by documents.created_at desc, documents.document_id`,
    [userId],
  );

  return Object.freeze(rows.map(documentRowFromDb));
}

export async function getUserUploadDocument(
  db: QueryExecutor,
  userId: string,
  documentId: string,
): Promise<DocumentRow | null> {
  // Validate documentId first so the public `getUserUploadDocument(db, userId, documentId)`
  // arity reads naturally — but both must be checked before any query.
  assertUuidV4(documentId, "document_id");
  assertUuidV4(userId, "user_id");

  const { rows } = await db.query<DocumentDbRow>(
    `select ${DOCUMENT_COLUMNS_QUALIFIED}
       from documents
       join sources on sources.source_id = documents.source_id
      where documents.document_id = $1
        and sources.user_id = $2
        and sources.kind = 'upload'
        and documents.deleted_at is null`,
    [documentId, userId],
  );

  return rows[0] ? documentRowFromDb(rows[0]) : null;
}

function documentRowFromDb(row: DocumentDbRow): DocumentRow {
  return Object.freeze({
    document_id: row.document_id,
    source_id: row.source_id,
    provider_doc_id: row.provider_doc_id,
    kind: row.kind,
    parent_document_id: row.parent_document_id,
    conversation_id: row.conversation_id,
    title: row.title,
    author: row.author,
    published_at: nullableIsoString(row.published_at),
    lang: row.lang,
    content_hash: row.content_hash,
    raw_blob_id: row.raw_blob_id,
    parse_status: row.parse_status as ParseStatus,
    deleted_at: nullableIsoString(row.deleted_at),
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  });
}

function nullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : isoString(value);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

// Defensive guard: if DOCUMENT_KINDS ever drops "upload" we'd silently
// route this orchestrator's documents into a kind the rest of the system
// doesn't recognize. Asserting at module load surfaces the regression
// before any caller reaches it.
if (!DOCUMENT_KINDS.includes("upload")) {
  throw new Error(
    'user-uploads: DOCUMENT_KINDS must include "upload" — update document-repo.ts before changing it',
  );
}
