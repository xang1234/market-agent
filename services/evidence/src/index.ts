export {
  SOURCE_KINDS,
  TRUST_TIERS,
  createSource,
  getSource,
} from "./source-repo.ts";
export type {
  SourceInput,
  SourceKind,
  SourceRow,
  TrustTier,
} from "./source-repo.ts";

export {
  DOCUMENT_KINDS,
  PARSE_STATUSES,
  createDocument,
  getConversation,
  getDocument,
  getDocumentAncestors,
  getDocumentChildren,
  getDocumentThread,
} from "./document-repo.ts";
export type {
  CreateDocumentResult,
  DocumentInput,
  DocumentKind,
  DocumentRow,
  ParseStatus,
} from "./document-repo.ts";
export type { QueryExecutor } from "./types.ts";

export {
  EPHEMERAL_RAW_BLOB_ID_PREFIX,
  MemoryObjectStore,
  RAW_BLOB_ID_PREFIX,
  assertRawBlobId,
  assertRawBlobIdOrEphemeral,
  ephemeralRawBlobIdForSource,
  isEphemeralRawBlobId,
  rawBlobIdFromBytes,
} from "./object-store.ts";
export type {
  ObjectStore,
  PutResult,
  RawBlobMetadata,
  StoredBlob,
} from "./object-store.ts";

export { S3ObjectStore } from "./s3-object-store.ts";
export type { S3ObjectStoreConfig } from "./s3-object-store.ts";

export {
  EPHEMERAL_LICENSE_CLASSES,
  LicensePolicyError,
  PERMISSIVE_LICENSE_CLASSES,
  decideStoragePolicy,
} from "./license-policy.ts";
export type { StoragePolicy } from "./license-policy.ts";

export { ingestDocument } from "./ingest.ts";
export type {
  IngestDocumentDeps,
  IngestDocumentInput,
  IngestDocumentResult,
} from "./ingest.ts";
