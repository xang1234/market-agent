import {
  DOCUMENT_KINDS,
  type DocumentKind,
} from "./document-repo.ts";
import type { QueryExecutor } from "./types.ts";
import {
  assertIso8601WithOffset,
  assertNonEmptyString,
  assertOneOf,
  assertOptionalNonEmptyString,
  assertPositiveInteger,
  assertUuidV4,
} from "./validators.ts";

export const IR_SOURCE_TYPES = Object.freeze([
  "rss",
  "atom",
  "sitemap",
  "html_index",
  "hosted_pattern",
  "manual_url",
] as const);

export const IR_ASSET_KINDS = Object.freeze([
  "press_release",
  "presentation",
  "transcript",
] as const);

export type IrSourceType = (typeof IR_SOURCE_TYPES)[number];
export type IrAssetKind = (typeof IR_ASSET_KINDS)[number];

export type IrSourceRegistryInput = {
  issuer_id: string;
  source_type: IrSourceType;
  url: string;
  provider_hint?: string | null;
  document_kind?: DocumentKind | null;
  enabled?: boolean;
  crawl_interval_seconds?: number;
};

export type IrSourceRegistryRow = {
  ir_source_id: string;
  issuer_id: string;
  source_type: IrSourceType;
  url: string;
  provider_hint: string | null;
  document_kind: DocumentKind | null;
  enabled: boolean;
  last_crawled_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  etag: string | null;
  last_modified: string | null;
  crawl_interval_seconds: number;
  created_at: string;
  updated_at: string;
};

export type IrDocumentAssetInput = {
  ir_source_id?: string | null;
  issuer_id: string;
  document_id: string;
  source_id: string;
  asset_kind: IrAssetKind;
  canonical_url: string;
  hosted_provider?: string | null;
  issuer_attested?: boolean;
  content_type?: string | null;
  discovered_at: string;
  fetched_at: string;
};

export type IrDocumentAssetRow = {
  ir_document_asset_id: string;
  ir_source_id: string | null;
  issuer_id: string;
  document_id: string;
  source_id: string;
  asset_kind: IrAssetKind;
  canonical_url: string;
  hosted_provider: string | null;
  issuer_attested: boolean;
  content_type: string | null;
  discovered_at: string;
  fetched_at: string;
  created_at: string;
};

type IrSourceRegistryDbRow = Omit<
  IrSourceRegistryRow,
  "last_crawled_at" | "last_success_at" | "created_at" | "updated_at"
> & {
  last_crawled_at: Date | string | null;
  last_success_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type IrDocumentAssetDbRow = Omit<
  IrDocumentAssetRow,
  "discovered_at" | "fetched_at" | "created_at"
> & {
  discovered_at: Date | string;
  fetched_at: Date | string;
  created_at: Date | string;
};

const IR_SOURCE_COLUMNS = `ir_source_id::text as ir_source_id,
               issuer_id::text as issuer_id,
               source_type,
               url,
               provider_hint,
               document_kind,
               enabled,
               last_crawled_at,
               last_success_at,
               last_error,
               etag,
               last_modified,
               crawl_interval_seconds,
               created_at,
               updated_at`;

const IR_ASSET_COLUMNS = `ir_document_asset_id::text as ir_document_asset_id,
               ir_source_id::text as ir_source_id,
               issuer_id::text as issuer_id,
               document_id::text as document_id,
               source_id::text as source_id,
               asset_kind,
               canonical_url,
               hosted_provider,
               issuer_attested,
               content_type,
               discovered_at,
               fetched_at,
               created_at`;

export async function createIrSourceRegistryEntry(
  db: QueryExecutor,
  input: IrSourceRegistryInput,
): Promise<IrSourceRegistryRow> {
  const normalized = normalizeIrSourceRegistryInput(input);
  const { rows } = await db.query<IrSourceRegistryDbRow>(
    `insert into ir_source_registry
       (issuer_id, source_type, url, provider_hint, document_kind, enabled, crawl_interval_seconds)
     values ($1::uuid, $2::ir_source_type, $3, $4, $5::document_kind, $6, $7)
     returning ${IR_SOURCE_COLUMNS}`,
    [
      normalized.issuer_id,
      normalized.source_type,
      normalized.url,
      normalized.provider_hint,
      normalized.document_kind,
      normalized.enabled,
      normalized.crawl_interval_seconds,
    ],
  );
  return irSourceRegistryRowFromDb(rows[0]);
}

export async function listEnabledIrSourceRegistryEntries(
  db: QueryExecutor,
  issuerId?: string,
): Promise<readonly IrSourceRegistryRow[]> {
  if (issuerId !== undefined) assertUuidV4(issuerId, "issuer_id");
  const { rows } = await db.query<IrSourceRegistryDbRow>(
    `select ${IR_SOURCE_COLUMNS}
       from ir_source_registry
      where enabled = true
        and ($1::uuid is null or issuer_id = $1::uuid)
      order by issuer_id, source_type, url`,
    [issuerId ?? null],
  );
  return Object.freeze(rows.map(irSourceRegistryRowFromDb));
}

export async function recordIrSourceCrawlSuccess(
  db: QueryExecutor,
  input: {
    ir_source_id: string;
    crawled_at: string;
    etag?: string | null;
    last_modified?: string | null;
  },
): Promise<void> {
  assertUuidV4(input.ir_source_id, "ir_source_id");
  assertIso8601WithOffset(input.crawled_at, "crawled_at");
  assertOptionalNonEmptyString(input.etag, "etag");
  assertOptionalNonEmptyString(input.last_modified, "last_modified");
  await db.query(
    `update ir_source_registry
        set last_crawled_at = $2::timestamptz,
            last_success_at = $2::timestamptz,
            last_error = null,
            etag = coalesce($3, etag),
            last_modified = coalesce($4, last_modified),
            updated_at = now()
      where ir_source_id = $1::uuid`,
    [input.ir_source_id, new Date(input.crawled_at).toISOString(), input.etag ?? null, input.last_modified ?? null],
  );
}

export async function recordIrSourceCrawlFailure(
  db: QueryExecutor,
  input: {
    ir_source_id: string;
    crawled_at: string;
    error: string;
  },
): Promise<void> {
  assertUuidV4(input.ir_source_id, "ir_source_id");
  assertIso8601WithOffset(input.crawled_at, "crawled_at");
  assertNonEmptyString(input.error, "error");
  await db.query(
    `update ir_source_registry
        set last_crawled_at = $2::timestamptz,
            last_error = $3,
            updated_at = now()
      where ir_source_id = $1::uuid`,
    [input.ir_source_id, new Date(input.crawled_at).toISOString(), input.error],
  );
}

export async function findIrDocumentAssetByIssuerUrl(
  db: QueryExecutor,
  issuerId: string,
  canonicalUrl: string,
): Promise<IrDocumentAssetRow | null> {
  assertUuidV4(issuerId, "issuer_id");
  assertHttpsUrl(canonicalUrl, "canonical_url");
  const { rows } = await db.query<IrDocumentAssetDbRow>(
    `select ${IR_ASSET_COLUMNS}
       from ir_document_assets
      where issuer_id = $1::uuid
        and canonical_url = $2
      limit 1`,
    [issuerId, canonicalUrl],
  );
  return rows[0] ? irDocumentAssetRowFromDb(rows[0]) : null;
}

export async function getIrDocumentAssetForDocument(
  db: QueryExecutor,
  documentId: string,
): Promise<IrDocumentAssetRow | null> {
  assertUuidV4(documentId, "document_id");
  const { rows } = await db.query<IrDocumentAssetDbRow>(
    `select ${IR_ASSET_COLUMNS}
       from ir_document_assets
      where document_id = $1::uuid
      limit 1`,
    [documentId],
  );
  return rows[0] ? irDocumentAssetRowFromDb(rows[0]) : null;
}

export async function createIrDocumentAsset(
  db: QueryExecutor,
  input: IrDocumentAssetInput,
): Promise<IrDocumentAssetRow> {
  const normalized = normalizeIrDocumentAssetInput(input);
  const { rows } = await db.query<IrDocumentAssetDbRow>(
    `insert into ir_document_assets
       (ir_source_id,
        issuer_id,
        document_id,
        source_id,
        asset_kind,
        canonical_url,
        hosted_provider,
        issuer_attested,
        content_type,
        discovered_at,
        fetched_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::ir_asset_kind, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)
     returning ${IR_ASSET_COLUMNS}`,
    [
      normalized.ir_source_id,
      normalized.issuer_id,
      normalized.document_id,
      normalized.source_id,
      normalized.asset_kind,
      normalized.canonical_url,
      normalized.hosted_provider,
      normalized.issuer_attested,
      normalized.content_type,
      normalized.discovered_at,
      normalized.fetched_at,
    ],
  );
  return irDocumentAssetRowFromDb(rows[0]);
}

function normalizeIrSourceRegistryInput(input: IrSourceRegistryInput): Required<IrSourceRegistryInput> {
  assertUuidV4(input.issuer_id, "issuer_id");
  assertOneOf(input.source_type, IR_SOURCE_TYPES, "source_type");
  assertHttpsUrl(input.url, "url");
  assertOptionalNonEmptyString(input.provider_hint, "provider_hint");
  if (input.document_kind != null) assertOneOf(input.document_kind, DOCUMENT_KINDS, "document_kind");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    throw new Error("enabled: must be boolean");
  }
  if (input.crawl_interval_seconds !== undefined) {
    assertPositiveInteger(input.crawl_interval_seconds, "crawl_interval_seconds");
  }
  return {
    issuer_id: input.issuer_id,
    source_type: input.source_type,
    url: input.url,
    provider_hint: input.provider_hint ?? null,
    document_kind: input.document_kind ?? null,
    enabled: input.enabled ?? false,
    crawl_interval_seconds: input.crawl_interval_seconds ?? 86_400,
  };
}

function normalizeIrDocumentAssetInput(input: IrDocumentAssetInput): Required<IrDocumentAssetInput> {
  if (input.ir_source_id != null) assertUuidV4(input.ir_source_id, "ir_source_id");
  assertUuidV4(input.issuer_id, "issuer_id");
  assertUuidV4(input.document_id, "document_id");
  assertUuidV4(input.source_id, "source_id");
  assertOneOf(input.asset_kind, IR_ASSET_KINDS, "asset_kind");
  assertHttpsUrl(input.canonical_url, "canonical_url");
  assertOptionalNonEmptyString(input.hosted_provider, "hosted_provider");
  if (input.issuer_attested !== undefined && typeof input.issuer_attested !== "boolean") {
    throw new Error("issuer_attested: must be boolean");
  }
  assertOptionalNonEmptyString(input.content_type, "content_type");
  assertIso8601WithOffset(input.discovered_at, "discovered_at");
  assertIso8601WithOffset(input.fetched_at, "fetched_at");
  return {
    ir_source_id: input.ir_source_id ?? null,
    issuer_id: input.issuer_id,
    document_id: input.document_id,
    source_id: input.source_id,
    asset_kind: input.asset_kind,
    canonical_url: input.canonical_url,
    hosted_provider: input.hosted_provider ?? null,
    issuer_attested: input.issuer_attested ?? true,
    content_type: input.content_type ?? null,
    discovered_at: new Date(input.discovered_at).toISOString(),
    fetched_at: new Date(input.fetched_at).toISOString(),
  };
}

function irSourceRegistryRowFromDb(row: IrSourceRegistryDbRow | undefined): IrSourceRegistryRow {
  if (!row) throw new Error("ir_source_registry insert did not return a row");
  return Object.freeze({
    ir_source_id: row.ir_source_id,
    issuer_id: row.issuer_id,
    source_type: row.source_type,
    url: row.url,
    provider_hint: row.provider_hint,
    document_kind: row.document_kind,
    enabled: row.enabled,
    last_crawled_at: nullableIso(row.last_crawled_at),
    last_success_at: nullableIso(row.last_success_at),
    last_error: row.last_error,
    etag: row.etag,
    last_modified: row.last_modified,
    crawl_interval_seconds: Number(row.crawl_interval_seconds),
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  });
}

function irDocumentAssetRowFromDb(row: IrDocumentAssetDbRow | undefined): IrDocumentAssetRow {
  if (!row) throw new Error("ir_document_assets insert did not return a row");
  return Object.freeze({
    ir_document_asset_id: row.ir_document_asset_id,
    ir_source_id: row.ir_source_id,
    issuer_id: row.issuer_id,
    document_id: row.document_id,
    source_id: row.source_id,
    asset_kind: row.asset_kind,
    canonical_url: row.canonical_url,
    hosted_provider: row.hosted_provider,
    issuer_attested: row.issuer_attested,
    content_type: row.content_type,
    discovered_at: isoString(row.discovered_at),
    fetched_at: isoString(row.fetched_at),
    created_at: isoString(row.created_at),
  });
}

function assertHttpsUrl(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}: must be a valid https URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label}: must use https`);
  }
}

function nullableIso(value: Date | string | null): string | null {
  return value == null ? null : isoString(value);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
