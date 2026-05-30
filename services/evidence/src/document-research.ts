import { assertSubjectRef, type SubjectRef } from "../../shared/src/subject-ref.ts";
import {
  sourceDisclosure,
  storagePolicyForDocument,
} from "./source-disclosure.ts";
import {
  DOCUMENT_KINDS,
  type DocumentKind,
} from "./document-repo.ts";
import { isEphemeralRawBlobId } from "./object-store.ts";
import type { QueryExecutor } from "./types.ts";
import {
  assertIso8601WithOffset,
  assertOneOf,
  assertOptionalNonEmptyString,
  assertPositiveInteger,
  assertUuidV4,
} from "./validators.ts";

export type EvidenceDocumentResearchInput = {
  query?: string;
  subjectRefs?: ReadonlyArray<SubjectRef>;
  canonicalUrl?: string;
  domain?: string;
  kind?: DocumentKind;
  publishedFrom?: string;
  publishedTo?: string;
  userId?: string | null;
  limit?: number;
};

export type FetchEvidenceDocumentMetadataInput = {
  documentId: string;
  userId?: string | null;
};

export type EvidenceDocumentResearchResult = Readonly<{
  document_id: string;
  source_id: string;
  kind: DocumentKind;
  title: string | null;
  author: string | null;
  published_at: string | null;
  canonical_url: string | null;
  provider: string;
  trust_tier: string;
  license_class: string;
  storage_policy: string;
  source_disclosure: string | null;
  raw_available: boolean;
}>;

export type SearchEvidenceDocumentsResult = Readonly<{
  documents: ReadonlyArray<EvidenceDocumentResearchResult>;
}>;

type DocumentResearchRow = {
  document_id: string;
  source_id: string;
  kind: DocumentKind;
  title: string | null;
  author: string | null;
  published_at: Date | string | null;
  canonical_url: string | null;
  provider: string;
  trust_tier: string;
  license_class: string;
  raw_blob_id: string;
};

export async function searchEvidenceDocuments(
  db: QueryExecutor,
  input: EvidenceDocumentResearchInput,
): Promise<SearchEvidenceDocumentsResult> {
  const normalized = normalizeSearchInput(input);
  const { rows } = await db.query<DocumentResearchRow>(
    `select d.document_id::text as document_id,
            d.source_id::text as source_id,
            d.kind,
            d.title,
            d.author,
            d.published_at,
            s.canonical_url,
            s.provider,
            s.trust_tier,
            s.license_class,
            d.raw_blob_id
       from documents d
       join sources s
         on s.source_id = d.source_id
      where d.deleted_at is null
        and (
          $1::text is null
          or d.title ilike ('%' || $1::text || '%')
          or d.author ilike ('%' || $1::text || '%')
          or s.provider ilike ('%' || $1::text || '%')
          or s.canonical_url ilike ('%' || $1::text || '%')
        )
        and (
          $2::jsonb = '[]'::jsonb
          or exists (
            select 1
              from mentions m
              join jsonb_to_recordset($2::jsonb) as refs(kind text, id text)
                on m.subject_kind = refs.kind::subject_kind
               and m.subject_id = refs.id::uuid
             where m.document_id = d.document_id
          )
        )
        and ($3::text is null or s.canonical_url = $3::text)
        and ($4::text is null or s.canonical_url ilike $4::text)
        and ($5::text is null or d.kind = $5::document_kind)
        and ($6::timestamptz is null or d.published_at >= $6::timestamptz)
        and ($7::timestamptz is null or d.published_at <= $7::timestamptz)
        and (s.user_id is null or ($8::uuid is not null and s.user_id = $8::uuid))
      order by d.published_at desc nulls last,
               d.document_id desc
      limit $9`,
    [
      normalized.query,
      JSON.stringify(normalized.subjectRefs),
      normalized.canonicalUrl,
      normalized.domainPattern,
      normalized.kind,
      normalized.publishedFrom,
      normalized.publishedTo,
      normalized.userId,
      normalized.limit,
    ],
  );

  return Object.freeze({
    documents: Object.freeze(rows.map(documentResearchResultFromRow)),
  });
}

export async function fetchEvidenceDocumentMetadata(
  db: QueryExecutor,
  input: FetchEvidenceDocumentMetadataInput,
): Promise<EvidenceDocumentResearchResult | null> {
  assertUuidV4(input.documentId, "document_id");
  const userId = userIdOrNull(input.userId);
  const { rows } = await db.query<DocumentResearchRow>(
    `select d.document_id::text as document_id,
            d.source_id::text as source_id,
            d.kind,
            d.title,
            d.author,
            d.published_at,
            s.canonical_url,
            s.provider,
            s.trust_tier,
            s.license_class,
            d.raw_blob_id
       from documents d
       join sources s
         on s.source_id = d.source_id
      where d.document_id = $1::uuid
        and d.deleted_at is null
        and (s.user_id is null or ($2::uuid is not null and s.user_id = $2::uuid))`,
    [input.documentId, userId],
  );
  return rows[0] ? documentResearchResultFromRow(rows[0]) : null;
}

function normalizeSearchInput(input: EvidenceDocumentResearchInput): Required<{
  query: string | null;
  subjectRefs: ReadonlyArray<SubjectRef>;
  canonicalUrl: string | null;
  domainPattern: string | null;
  kind: DocumentKind | null;
  publishedFrom: string | null;
  publishedTo: string | null;
  userId: string | null;
  limit: number;
}> {
  assertOptionalNonEmptyString(input.query, "query");
  assertOptionalNonEmptyString(input.canonicalUrl, "canonical_url");
  assertOptionalNonEmptyString(input.domain, "domain");
  if (input.kind !== undefined) {
    assertOneOf(input.kind, DOCUMENT_KINDS, "kind");
  }
  if (input.publishedFrom !== undefined) {
    assertIso8601WithOffset(input.publishedFrom, "publishedFrom");
  }
  if (input.publishedTo !== undefined) {
    assertIso8601WithOffset(input.publishedTo, "publishedTo");
  }
  if (
    input.publishedFrom !== undefined &&
    input.publishedTo !== undefined &&
    Date.parse(input.publishedFrom) > Date.parse(input.publishedTo)
  ) {
    throw new Error("publishedFrom: must be before or equal to publishedTo");
  }
  if (input.limit !== undefined) {
    assertPositiveInteger(input.limit, "limit");
  }
  const subjectRefs = input.subjectRefs ?? [];
  if (!Array.isArray(subjectRefs)) {
    throw new Error("subjectRefs: must be an array");
  }
  for (const [index, ref] of subjectRefs.entries()) {
    assertSubjectRef(ref, `subjectRefs[${index}]`);
  }
  if (
    input.query === undefined &&
    subjectRefs.length === 0 &&
    input.canonicalUrl === undefined &&
    input.domain === undefined &&
    input.kind === undefined &&
    input.publishedFrom === undefined &&
    input.publishedTo === undefined
  ) {
    throw new Error("searchEvidenceDocuments: at least one filter is required");
  }

  return {
    query: input.query ?? null,
    subjectRefs: Object.freeze(subjectRefs.map((ref) => Object.freeze({ kind: ref.kind, id: ref.id }))),
    canonicalUrl: input.canonicalUrl ?? null,
    domainPattern: input.domain === undefined ? null : `%${input.domain.trim().toLowerCase()}%`,
    kind: input.kind ?? null,
    publishedFrom: input.publishedFrom === undefined ? null : new Date(input.publishedFrom).toISOString(),
    publishedTo: input.publishedTo === undefined ? null : new Date(input.publishedTo).toISOString(),
    userId: userIdOrNull(input.userId),
    limit: input.limit ?? 20,
  };
}

function documentResearchResultFromRow(row: DocumentResearchRow): EvidenceDocumentResearchResult {
  return Object.freeze({
    document_id: row.document_id,
    source_id: row.source_id,
    kind: row.kind,
    title: row.title,
    author: row.author,
    published_at: row.published_at === null ? null : isoString(row.published_at),
    canonical_url: row.canonical_url,
    provider: row.provider,
    trust_tier: row.trust_tier,
    license_class: row.license_class,
    storage_policy: storagePolicyForDocument(row),
    source_disclosure: sourceDisclosure(row),
    raw_available: !isEphemeralRawBlobId(row.raw_blob_id),
  });
}

function userIdOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  assertUuidV4(value, "user_id");
  return value;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
