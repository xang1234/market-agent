export {
  COVERAGE_LEVELS,
  FACT_METHODS,
  FACT_PERIOD_KINDS,
  FACT_REVIEW_STATUSES,
  FACT_SUBJECT_KINDS,
  FRESHNESS_CLASSES,
  createFact,
  queueFactReview,
  supersedeFact,
  supersedeFactWithPool,
} from "./fact-repo.ts";
export type {
  CoverageLevel,
  FactClientPool,
  FactInput,
  FactMethod,
  FactPoolClient,
  FactPeriodKind,
  FactReviewQueueRow,
  FactReviewStatus,
  FactRow,
  FactSubjectKind,
  FreshnessClass,
  QueueFactReviewInput,
  SupersedeFactResult,
} from "./fact-repo.ts";

export {
  PROMOTION_REVIEW_CONFIDENCE_THRESHOLD,
  PROMOTION_VERIFICATION_STATUSES,
  decideCandidateFactPromotion,
} from "./promotion-rules.ts";
export type {
  CandidateFactPromotionDecision,
  CandidateFactPromotionInput,
  PromotionVerificationStatus,
} from "./promotion-rules.ts";

export {
  CLAIM_ARGUMENT_ROLES,
  createClaimArgument,
  listClaimArgumentsForClaim,
} from "./claim-argument-repo.ts";
export type {
  ClaimArgumentInput,
  ClaimArgumentRole,
  ClaimArgumentRow,
} from "./claim-argument-repo.ts";

export {
  CLAIM_CLUSTER_MEMBER_RELATIONS,
  addClaimClusterMember,
  buildClaimCanonicalSignature,
  getClaimClusterBySignature,
  upsertClaimCluster,
} from "./claim-cluster-repo.ts";
export type {
  AddClaimClusterMemberResult,
  ClaimCanonicalSignatureInput,
  ClaimClusterInput,
  ClaimClusterMemberInput,
  ClaimClusterMemberRelation,
  ClaimClusterMemberRow,
  ClaimClusterRow,
} from "./claim-cluster-repo.ts";

export {
  createClaimEvidence,
  listClaimEvidenceForClaim,
} from "./claim-evidence-repo.ts";
export type {
  ClaimEvidenceInput,
  ClaimEvidenceRow,
} from "./claim-evidence-repo.ts";

export {
  assembleEvidenceBundle,
  buildEvidenceBundle,
  getEvidenceBundle,
} from "./evidence-bundle-repo.ts";
export type {
  AssembledEvidenceBundle,
  EvidenceBundle,
  EvidenceBundleDocument,
  EvidenceBundleEvidence,
  EvidenceBundleInput,
} from "./evidence-bundle-repo.ts";

export {
  EVENT_STATUSES,
  EVENT_TYPES,
  createEvent,
  createEventSubject,
  listEventSubjectsForEvent,
} from "./event-repo.ts";
export type {
  EventInput,
  EventRow,
  EventStatus,
  EventSubjectInput,
  EventSubjectRow,
  EventType,
} from "./event-repo.ts";

export {
  CLAIM_MODALITIES,
  CLAIM_POLARITIES,
  CLAIM_STATUSES,
  createClaim,
  listClaimsForDocument,
} from "./claim-repo.ts";
export type {
  ClaimInput,
  ClaimModality,
  ClaimPolarity,
  ClaimRow,
  ClaimStatus,
} from "./claim-repo.ts";

export {
  ENTITY_IMPACT_CHANNELS,
  IMPACT_DIRECTIONS,
  IMPACT_HORIZONS,
  createEntityImpact,
  listEntityImpactsForClaim,
} from "./entity-impact-repo.ts";
export type {
  EntityImpactChannel,
  EntityImpactInput,
  EntityImpactRow,
  ImpactDirection,
  ImpactHorizon,
} from "./entity-impact-repo.ts";

export {
  SOURCE_KINDS,
  TRUST_TIERS,
  createSource,
  deleteSource,
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
  MENTION_PROMINENCES,
  createMention,
  deleteMentionsForDocumentExcept,
  listMentionsForDocument,
} from "./mention-repo.ts";
export type {
  MentionIdentity,
  MentionInput,
  MentionProminence,
  MentionRow,
} from "./mention-repo.ts";

export {
  EPHEMERAL_RAW_BLOB_ID_PREFIX,
  MemoryObjectStore,
  RAW_BLOB_ID_PREFIX,
  assertRawBlobId,
  assertRawBlobIdOrEphemeral,
  contentHashFromBytes,
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

export {
  createObjectBlobGcWorker,
  deleteUserAndQueueObjectBlobs,
  deleteUserAndQueueObjectBlobsWithPool,
  objectBlobGcTransactionClient,
  runObjectBlobGcBatch,
  runObjectBlobGcBatchWithPool,
} from "./blob-gc-repo.ts";
export type {
  DeleteUserBlobQueueResult,
  ObjectBlobGcBatchOptions,
  ObjectBlobGcBatchResult,
  ObjectBlobGcClientPool,
  ObjectBlobGcPoolClient,
  ObjectBlobGcTransactionClient,
  ObjectBlobGcWorker,
  ObjectBlobGcWorkerConfig,
} from "./blob-gc-repo.ts";

export { S3ObjectStore } from "./s3-object-store.ts";
export type { S3ObjectStoreConfig } from "./s3-object-store.ts";

export {
  EPHEMERAL_LICENSE_CLASSES,
  LicensePolicyError,
  PERMISSIVE_LICENSE_CLASSES,
  decideStoragePolicy,
} from "./license-policy.ts";
export type { StoragePolicy } from "./license-policy.ts";

export {
  ingestDocument,
  ingestDocumentWithPool,
} from "./ingest.ts";
export type {
  IngestDocumentClientPool,
  IngestDocumentDeps,
  IngestDocumentInput,
  IngestDocumentPoolClient,
  IngestDocumentResult,
} from "./ingest.ts";

export {
  NEWS_ARTICLE_ALLOWED_LICENSE_CLASSES,
  NEWS_ARTICLE_ALLOWED_TRUST_TIERS,
  PRESS_RELEASE_ALLOWED_LICENSE_CLASSES,
  PRESS_RELEASE_ALLOWED_TRUST_TIERS,
  TRANSCRIPT_ALLOWED_LICENSE_CLASSES,
  TRANSCRIPT_ALLOWED_TRUST_TIERS,
  canonicalizeNewsUrl,
  ingestEarningsTranscript,
  ingestNewsArticle,
  ingestPressRelease,
} from "./news-ingest.ts";
export type {
  IngestEarningsTranscriptInput,
  IngestNewsArticleInput,
  IngestPressReleaseInput,
} from "./news-ingest.ts";

export {
  USER_UPLOAD_LICENSE_CLASS,
  USER_UPLOAD_PROVIDER,
  getUserUploadDocument,
  ingestUserUpload,
  listUserUploadDocuments,
} from "./user-uploads.ts";
export type {
  IngestUserUploadDeps,
  IngestUserUploadInput,
  IngestUserUploadResult,
} from "./user-uploads.ts";

export { createEvidenceReaderToolHandlers } from "./reader/extract-tools.ts";
export type { EvidenceReaderToolDeps } from "./reader/extract-tools.ts";
export { linkDocumentMentions } from "./reader/entity-linker.ts";
export type {
  DetectedMentionCandidate,
  LinkDocumentMentionsResult,
  ResolveMention,
  SkippedMention,
} from "./reader/entity-linker.ts";
export { classifyMentionProminence } from "./reader/mention-prominence.ts";
export type { MentionProminenceSections } from "./reader/mention-prominence.ts";

export {
  SEC_EDGAR_DEFAULT_RATE_LIMIT,
  SEC_EDGAR_DEFAULT_REQUEST_TIMEOUT_MS,
  SEC_EDGAR_DEFAULT_USER_AGENT_ENV,
  SEC_FORM_CODES,
  SecEdgarClient,
  SecEdgarFetchError,
  SecEdgarRateLimitError,
  SecEdgarTimeoutError,
  TokenBucketRateLimiter,
  filingArchiveUrl,
  filingIndexUrl,
  ingestSecFiling,
} from "./sec-edgar.ts";
export type {
  FetchFilingInput,
  FetchFilingResult,
  IngestSecFilingDeps,
  IngestSecFilingInput,
  IngestSecFilingResult,
  RateLimiter,
  SecEdgarClientConfig,
  SecFormCode,
  TokenBucketRateLimiterConfig,
} from "./sec-edgar.ts";
