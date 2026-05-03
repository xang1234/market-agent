import { assertRawBlobIdOrEphemeral } from "./object-store.ts";
import type { QueryExecutor } from "./types.ts";
import {
  assertIso8601WithOffset,
  assertNonEmptyString,
  assertOneOf,
  assertOptionalNonEmptyString,
  assertUuidV4,
} from "./validators.ts";

export const DOCUMENT_KINDS = Object.freeze([
  "filing",
  "transcript",
  "article",
  "research_note",
  "social_post",
  "thread",
  "upload",
  "press_release",
] as const);

export const PARSE_STATUSES = Object.freeze([
  "pending",
  "parsed",
  "failed",
  "superseded",
] as const);

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type ParseStatus = (typeof PARSE_STATUSES)[number];

export type DocumentInput = {
  source_id: string;
  provider_doc_id?: string | null;
  kind: DocumentKind;
  parent_document_id?: string | null;
  conversation_id?: string | null;
  title?: string | null;
  author?: string | null;
  published_at?: string | null;
  lang?: string | null;
  content_hash: string;
  raw_blob_id: string;
  parse_status?: ParseStatus;
};

export type DocumentRow = {
  document_id: string;
  source_id: string;
  provider_doc_id: string | null;
  kind: DocumentKind;
  parent_document_id: string | null;
  conversation_id: string | null;
  title: string | null;
  author: string | null;
  published_at: string | null;
  lang: string | null;
  content_hash: string;
  raw_blob_id: string;
  parse_status: ParseStatus;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateDocumentResult =
  | { status: "created"; document: DocumentRow }
  | { status: "already_present"; document: DocumentRow };

type DocumentDbRow = Omit<
  DocumentRow,
  "published_at" | "deleted_at" | "created_at" | "updated_at"
> & {
  inserted: boolean;
  published_at: Date | string | null;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const DOCUMENT_COLUMNS = `document_id,
               source_id,
               provider_doc_id,
               kind,
               parent_document_id,
               conversation_id,
               title,
               author,
               published_at,
               lang,
               content_hash,
               raw_blob_id,
               parse_status,
               deleted_at,
               created_at,
               updated_at`;

export async function createDocument(
  db: QueryExecutor,
  input: DocumentInput,
): Promise<CreateDocumentResult> {
  const normalized = normalizeDocumentInput(input);

  const insert = await db.query<DocumentDbRow>(
    `insert into documents
       (source_id,
        provider_doc_id,
        kind,
        parent_document_id,
        conversation_id,
        title,
        author,
        published_at,
        lang,
        content_hash,
        raw_blob_id,
        parse_status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (content_hash, raw_blob_id) do update
       set content_hash = excluded.content_hash
     returning (xmax = 0) as inserted, ${DOCUMENT_COLUMNS}`,
    [
      normalized.source_id,
      normalized.provider_doc_id,
      normalized.kind,
      normalized.parent_document_id,
      normalized.conversation_id,
      normalized.title,
      normalized.author,
      normalized.published_at,
      normalized.lang,
      normalized.content_hash,
      normalized.raw_blob_id,
      normalized.parse_status,
    ],
  );

  const row = insert.rows[0];
  if (!row) {
    throw new Error("document insert did not return a row");
  }

  return Object.freeze({
    status: row.inserted ? "created" : "already_present",
    document: documentRowFromDb(row),
  });
}

export async function getDocument(
  db: QueryExecutor,
  documentId: string,
): Promise<DocumentRow | null> {
  assertUuidV4(documentId, "document_id");

  const { rows } = await db.query<DocumentDbRow>(
    `select ${DOCUMENT_COLUMNS}
       from documents
      where document_id = $1`,
    [documentId],
  );

  return rows[0] ? documentRowFromDb(rows[0]) : null;
}

export async function getDocumentChildren(
  db: QueryExecutor,
  parentDocumentId: string,
): Promise<readonly DocumentRow[]> {
  assertUuidV4(parentDocumentId, "parent_document_id");

  const { rows } = await db.query<DocumentDbRow>(
    `select ${DOCUMENT_COLUMNS}
       from documents
      where parent_document_id = $1
      order by published_at nulls last, document_id`,
    [parentDocumentId],
  );

  return Object.freeze(rows.map(documentRowFromDb));
}

export async function getDocumentAncestors(
  db: QueryExecutor,
  documentId: string,
): Promise<readonly DocumentRow[]> {
  assertUuidV4(documentId, "document_id");

  const { rows } = await db.query<DocumentDbRow & { depth: number }>(
    `with recursive chain as (
       select ${DOCUMENT_COLUMNS}, 0 as depth
         from documents
        where document_id = $1
       union all
       select ${prefixedDocumentColumns("d")}, c.depth + 1
         from documents d
         join chain c on c.parent_document_id = d.document_id
     )
     select ${DOCUMENT_COLUMNS}, depth
       from chain
      order by depth desc`,
    [documentId],
  );

  return Object.freeze(rows.map(documentRowFromDb));
}

export async function getDocumentThread(
  db: QueryExecutor,
  rootDocumentId: string,
): Promise<readonly DocumentRow[]> {
  assertUuidV4(rootDocumentId, "document_id");

  const { rows } = await db.query<DocumentDbRow & { depth: number }>(
    `with recursive thread as (
       select ${DOCUMENT_COLUMNS}, 0 as depth
         from documents
        where document_id = $1
       union all
       select ${prefixedDocumentColumns("d")}, t.depth + 1
         from documents d
         join thread t on d.parent_document_id = t.document_id
     )
     select ${DOCUMENT_COLUMNS}, depth
       from thread
      order by depth, published_at nulls last, document_id`,
    [rootDocumentId],
  );

  return Object.freeze(rows.map(documentRowFromDb));
}

export async function getConversation(
  db: QueryExecutor,
  conversationId: string,
): Promise<readonly DocumentRow[]> {
  assertNonEmptyString(conversationId, "conversation_id");

  const { rows } = await db.query<DocumentDbRow>(
    `select ${DOCUMENT_COLUMNS}
       from documents
      where conversation_id = $1
      order by published_at nulls last, document_id`,
    [conversationId],
  );

  return Object.freeze(rows.map(documentRowFromDb));
}

function prefixedDocumentColumns(alias: string): string {
  return DOCUMENT_COLUMNS.split(",")
    .map((col) => `${alias}.${col.trim()}`)
    .join(", ");
}

function normalizeDocumentInput(input: DocumentInput): Required<DocumentInput> {
  assertUuidV4(input.source_id, "source_id");
  assertOptionalNonEmptyString(input.provider_doc_id, "provider_doc_id");
  assertOneOf(input.kind, DOCUMENT_KINDS, "kind");
  if (input.parent_document_id != null) {
    assertUuidV4(input.parent_document_id, "parent_document_id");
  }
  assertOptionalNonEmptyString(input.conversation_id, "conversation_id");
  assertOptionalNonEmptyString(input.title, "title");
  assertOptionalNonEmptyString(input.author, "author");
  if (input.published_at != null) {
    assertIso8601WithOffset(input.published_at, "published_at");
  }
  assertOptionalNonEmptyString(input.lang, "lang");
  assertNonEmptyString(input.content_hash, "content_hash");
  assertRawBlobIdOrEphemeral(input.raw_blob_id);
  const parseStatus = input.parse_status ?? "pending";
  assertOneOf(parseStatus, PARSE_STATUSES, "parse_status");

  return {
    source_id: input.source_id,
    provider_doc_id: input.provider_doc_id ?? null,
    kind: input.kind,
    parent_document_id: input.parent_document_id ?? null,
    conversation_id: input.conversation_id ?? null,
    title: input.title ?? null,
    author: input.author ?? null,
    published_at: input.published_at ?? null,
    lang: input.lang ?? null,
    content_hash: input.content_hash,
    raw_blob_id: input.raw_blob_id,
    parse_status: parseStatus,
  };
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
    parse_status: row.parse_status,
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
