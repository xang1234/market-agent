import { createHash } from "node:crypto";
import { createMention } from "./mention-repo.ts";
import { isEphemeralRawBlobId, type ObjectStore } from "./object-store.ts";
import { issuerIrTextFromBytes } from "./issuer-ir-extraction.ts";
import { ingestDocument } from "./ingest.ts";
import { createIrDocumentAsset, listEnabledIrSourceRegistryEntries, type IrSourceRegistryRow } from "./issuer-ir-registry.ts";
import { discoverIssuerIrCandidates, hostedProviderFromUrl } from "./providers/issuer-ir.ts";
import { createPinnedHttpsFetch, type PublicDocumentDns, type PublicDocumentTransport } from "./public-document-fetch.ts";
import { SecEdgarClient, filingArchiveUrl, recentSubmissionRows, type SecEdgarClientConfig, type SecSubmissions } from "./sec-edgar.ts";
import { deleteSource, createSource } from "./source-repo.ts";
import type { QueryExecutor } from "./types.ts";

const MAX_DOCUMENTS_PER_COMPANY = 6;

export type CampaignDocumentClaim = Readonly<{
  claim_id: string;
  source_id: string;
  text_canonical: string;
}>;
export type CampaignDocument = Readonly<{
  document_id: string;
  source_id: string;
  family_key: string;
  title: string;
  url: string;
  published_at: string | null;
  retrieved_at: string;
  document_hash: string;
  normalized_text: string;
  primary: boolean;
  primary_eligible: boolean;
  claims: readonly CampaignDocumentClaim[];
}>;
export type CampaignStoredDocumentClaim = Readonly<{
  claim_id: string;
  reporting_source_id: string;
  text_canonical: string;
}>;
export type CampaignStoredDocument = Omit<CampaignDocument, "claims"> & Readonly<{
  owner_user_id: string | null;
  claims: readonly CampaignStoredDocumentClaim[];
}>;
export type CampaignDocumentRepository = {
  load(input: { issuer_id: string; user_id: string; limit: number }): Promise<readonly CampaignStoredDocument[]>;
  store(input: {
    issuer_id: string;
    url: string;
    title: string;
    published_at: string | null;
    retrieved_at: string;
    provider: "sec_edgar" | "issuer_ir";
    kind: "filing" | "press_release" | "transcript";
    ir_source_id?: string;
    bytes: Uint8Array;
    content_type: string;
  }): Promise<CampaignDocument>;
};
export type CampaignDocumentFetcher = {
  fetch(url: string, signal?: AbortSignal): Promise<{ url: string; content_type: string; bytes: Uint8Array }>;
};
export type DocumentOperationRunner = {
  run<T>(input: {
    key: string;
    request_hash: string;
    resource: "document";
    phase: "discovery" | "research" | "verification";
    candidate_id?: string;
    execute: (context: { signal: AbortSignal; attempt_number: 1 | 2 }) => Promise<T>;
  }): Promise<T>;
};

export type SecPrimaryDocumentCandidate = Readonly<{
  url: string;
  title: string;
  published_at: string;
  provider: "sec_edgar";
  kind: "filing";
}>;
export type SecPrimaryDocumentCandidateFinder = {
  find(input: {
    issuer_id: string;
    operation_key: string;
    request_hash: string;
    candidate_id: string;
    phase: "discovery" | "research" | "verification";
    remaining_capacity?: number;
  }, operations: DocumentOperationRunner): Promise<readonly SecPrimaryDocumentCandidate[]>;
};

export type IssuerIrPrimaryDocumentCandidate = Readonly<{
  url: string;
  title: string;
  published_at: string | null;
  provider: "issuer_ir";
  kind: "press_release" | "transcript";
  ir_source_id: string;
}>;
export type IssuerIrPrimaryDocumentCandidateFinder = {
  find(input: {
    issuer_id: string;
    operation_key: string;
    request_hash: string;
    candidate_id: string;
    phase: "discovery" | "research" | "verification";
    remaining_capacity?: number;
  }, operations: DocumentOperationRunner): Promise<readonly IssuerIrPrimaryDocumentCandidate[]>;
};

type CikReader = { query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }> };
type SecSubmissionsFetcher = Pick<SecEdgarClient, "fetchSubmissions">;

export function createCampaignDocumentService(options: {
  user_id: string;
  repository: CampaignDocumentRepository;
  fetcher?: CampaignDocumentFetcher;
}) {
  return Object.freeze({
    async load(input: { issuer_id: string; limit?: number }): Promise<{ documents: readonly CampaignDocument[]; coverage_gaps: readonly string[] }> {
      const rows = await options.repository.load({
        issuer_id: input.issuer_id,
        user_id: options.user_id,
        limit: Math.min(Math.max(input.limit ?? MAX_DOCUMENTS_PER_COMPANY, 1), MAX_DOCUMENTS_PER_COMPANY),
      });
      for (const row of rows) {
        if (row.owner_user_id !== null && row.owner_user_id !== options.user_id) {
          throw new Error("campaign document is not visible to the current user");
        }
      }
      return Object.freeze({
        documents: Object.freeze(rows.map(({ owner_user_id: _owner, claims, ...document }) => Object.freeze({
          ...document,
          claims: Object.freeze(claims.map((claim) => Object.freeze({
            claim_id: claim.claim_id,
            source_id: claim.reporting_source_id,
            text_canonical: claim.text_canonical,
          }))),
        }))),
        coverage_gaps: Object.freeze([]),
      });
    },
    async fetchAndStore(input: {
      issuer_id: string;
      url: string;
      title: string;
      published_at: string | null;
      provider: "sec_edgar" | "issuer_ir";
      kind: "filing" | "press_release" | "transcript";
      operation_key: string;
      request_hash: string;
      phase: "discovery" | "research" | "verification";
      candidate_id?: string;
      ir_source_id?: string;
    }, operations: DocumentOperationRunner): Promise<CampaignDocument> {
      if (!options.fetcher) throw new Error("campaign document fetcher is not configured");
      return operations.run({
        key: input.operation_key,
        request_hash: input.request_hash,
        resource: "document",
        phase: input.phase,
        candidate_id: input.candidate_id,
        execute: async ({ signal }) => {
          const fetched = await options.fetcher!.fetch(input.url, signal);
          return options.repository.store({
            issuer_id: input.issuer_id,
            url: fetched.url,
            title: input.title,
            published_at: input.published_at,
            retrieved_at: new Date().toISOString(),
            provider: input.provider,
            kind: input.kind,
            ir_source_id: input.ir_source_id,
            bytes: fetched.bytes,
            content_type: fetched.content_type,
          });
        },
      });
    },
  });
}

// SEC metadata is not primary narrative evidence. It is only a bounded index
// used to select the filing URLs which the pinned document fetcher later reads.
export function createSecPrimaryDocumentCandidateFinder(options: {
  db: CikReader;
  sec: SecSubmissionsFetcher;
}): SecPrimaryDocumentCandidateFinder {
  return Object.freeze({
    async find(input, operations) {
      const remainingCapacity = documentCapacity(input.remaining_capacity);
      if (remainingCapacity === 0) return Object.freeze([]);
      const { rows } = await options.db.query<{ cik: string | null }>(
        "select cik from issuers where issuer_id = $1::uuid",
        [input.issuer_id],
      );
      const cik = Number(rows[0]?.cik);
      if (!Number.isInteger(cik) || cik <= 0) return Object.freeze([]);
      const submissions = await operations.run({
        key: `${input.operation_key}/sec-submissions`,
        request_hash: requestHash({ request_hash: input.request_hash, cik, kind: "sec-submissions" }),
        resource: "document",
        phase: input.phase,
        candidate_id: input.candidate_id,
        execute: () => options.sec.fetchSubmissions(cik),
      });
      return Object.freeze(selectSecPrimaryDocuments(cik, submissions, remainingCapacity));
    },
  });
}

export function createPinnedSecEdgarClient(options: Omit<SecEdgarClientConfig, "fetch"> & {
  dns?: PublicDocumentDns;
  transport?: PublicDocumentTransport;
}): SecEdgarClient {
  return new SecEdgarClient({
    ...options,
    fetch: createPinnedHttpsFetch({ dns: options.dns, transport: options.transport }),
  });
}

export function createIssuerIrPrimaryDocumentCandidateFinder(options: {
  list: (issuerId: string) => Promise<readonly IrSourceRegistryRow[]>;
  fetch: typeof fetch;
}): IssuerIrPrimaryDocumentCandidateFinder {
  return Object.freeze({
    async find(input, operations) {
      const remainingCapacity = documentCapacity(input.remaining_capacity);
      if (remainingCapacity === 0) return Object.freeze([]);
      const entries = await options.list(input.issuer_id);
      const candidates: IssuerIrPrimaryDocumentCandidate[] = [];
      for (const entry of entries.slice(0, remainingCapacity)) {
        const discovered = await operations.run({
          key: `${input.operation_key}/issuer-ir/${entry.ir_source_id}`,
          request_hash: requestHash({ request_hash: input.request_hash, ir_source_id: entry.ir_source_id }),
          resource: "document",
          phase: input.phase,
          candidate_id: input.candidate_id,
          execute: () => discoverIssuerIrCandidates(entry, { fetch: options.fetch }),
        });
        for (const candidate of discovered) {
          if (candidate.assetKind !== "press_release" && candidate.assetKind !== "transcript") continue;
          candidates.push(Object.freeze({
            url: candidate.canonicalUrl,
            title: candidate.title,
            published_at: candidate.publishedAt,
            provider: "issuer_ir",
            kind: candidate.assetKind,
            ir_source_id: entry.ir_source_id,
          }));
          if (candidates.length >= remainingCapacity) return Object.freeze(candidates);
        }
      }
      return Object.freeze(candidates);
    },
  });
}

export function createPinnedIssuerIrPrimaryDocumentCandidateFinder(options: {
  db: QueryExecutor;
  dns?: PublicDocumentDns;
  transport?: PublicDocumentTransport;
}): IssuerIrPrimaryDocumentCandidateFinder {
  return createIssuerIrPrimaryDocumentCandidateFinder({
    list: (issuerId) => listEnabledIrSourceRegistryEntries(options.db, issuerId),
    fetch: createPinnedHttpsFetch({ dns: options.dns, transport: options.transport }),
  });
}

function selectSecPrimaryDocuments(cik: number, submissions: SecSubmissions, remainingCapacity: number): SecPrimaryDocumentCandidate[] {
  const allowed = new Set(["10-K", "20-F", "10-Q", "6-K", "8-K"]);
  const forms = new Set<string>();
  const selected: SecPrimaryDocumentCandidate[] = [];
  for (const row of recentSubmissionRows(submissions.filings.recent)) {
    if (!allowed.has(row.form) || forms.has(row.form)) continue;
    forms.add(row.form);
    selected.push(Object.freeze({
      url: filingArchiveUrl({ cik, accession_number: row.accession, document: row.primaryDocument }),
      title: `${row.form} filed ${row.filedDate}`,
      published_at: new Date(`${row.filedDate}T00:00:00.000Z`).toISOString(),
      provider: "sec_edgar",
      kind: "filing",
    }));
    if (selected.length >= remainingCapacity) break;
  }
  return selected;
}

type StoredRow = {
  document_id: string; source_id: string; owner_user_id: string | null; family_key: string; title: string | null;
  url: string | null; published_at: Date | string | null; retrieved_at: Date | string; document_hash: string;
  raw_blob_id: string; primary: boolean; primary_eligible: boolean;
};

export function createPostgresCampaignDocumentRepository(options: {
  db: QueryExecutor;
  object_store: ObjectStore;
}): CampaignDocumentRepository {
  return Object.freeze({
    async load(input) {
      const { rows } = await options.db.query<StoredRow>(
        `select d.document_id::text as document_id,
                d.source_id::text as source_id,
                s.user_id::text as owner_user_id,
                coalesce(d.provider_doc_id, d.document_id::text) as family_key,
                d.title,
                s.canonical_url as url,
                d.published_at,
                s.retrieved_at,
                d.content_hash as document_hash,
                d.raw_blob_id,
                s.trust_tier = 'primary' as primary,
                (s.provider = 'sec_edgar' or exists (
                  select 1 from ir_document_assets a where a.document_id = d.document_id and a.issuer_id = $1::uuid and a.issuer_attested
                )) as primary_eligible
           from documents d
           join sources s on s.source_id = d.source_id
          where d.deleted_at is null
            and (s.user_id is null or s.user_id = $2::uuid)
            and (exists (
              select 1 from mentions m where m.document_id = d.document_id and m.subject_kind = 'issuer' and m.subject_id = $1::uuid
            ) or exists (
              select 1 from ir_document_assets a where a.document_id = d.document_id and a.issuer_id = $1::uuid
            ))
          order by d.published_at desc nulls last, d.document_id desc
          limit $3`,
        [input.issuer_id, input.user_id, input.limit],
      );
      const documents: CampaignStoredDocument[] = [];
      for (const row of rows) {
        if (isEphemeralRawBlobId(row.raw_blob_id)) continue;
        const blob = await options.object_store.get(row.raw_blob_id);
        if (!blob) continue;
        const normalized = issuerIrTextFromBytes({ bytes: blob.bytes, contentType: null });
        if (normalized.status !== "available" || !row.url || !row.title) continue;
        documents.push(Object.freeze({
          document_id: row.document_id,
          source_id: row.source_id,
          owner_user_id: row.owner_user_id,
          family_key: row.family_key,
          title: row.title,
          url: row.url,
          published_at: iso(row.published_at),
          retrieved_at: isoRequired(row.retrieved_at),
          document_hash: row.document_hash,
          normalized_text: normalized.text,
          primary: row.primary,
          primary_eligible: row.primary_eligible,
          claims: await loadClaims(options.db, row.document_id, input.user_id),
        }));
      }
      return Object.freeze(documents);
    },
    async store(input) {
      if (input.provider === "issuer_ir" && (!input.ir_source_id || input.kind === "filing")) {
        throw new Error("issuer IR campaign document requires a verified registry source and primary IR asset kind");
      }
      const source = await createSource(options.db, {
        provider: input.provider,
        kind: input.kind,
        canonical_url: input.url,
        trust_tier: "primary",
        license_class: "public",
        retrieved_at: input.retrieved_at,
        user_id: null,
      });
      try {
        const ingest = await ingestDocument({ db: options.db, objectStore: options.object_store }, {
          source: { source_id: source.source_id, license_class: source.license_class },
          bytes: input.bytes,
          document: { kind: input.kind, title: input.title, published_at: input.published_at },
        });
        await createMention(options.db, {
          document_id: ingest.document.document_id,
          subject_kind: "issuer",
          subject_id: input.issuer_id,
          prominence: "body",
          mention_count: 1,
          confidence: 1,
        });
        if (input.provider === "issuer_ir" && input.kind !== "filing") {
          await createIrDocumentAsset(options.db, {
            ir_source_id: input.ir_source_id,
            issuer_id: input.issuer_id,
            document_id: ingest.document.document_id,
            source_id: source.source_id,
            asset_kind: input.kind,
            canonical_url: input.url,
            hosted_provider: hostedProviderFromUrl(input.url),
            issuer_attested: true,
            content_type: input.content_type,
            discovered_at: input.retrieved_at,
            fetched_at: input.retrieved_at,
          });
        }
        const normalized = issuerIrTextFromBytes({ bytes: input.bytes, contentType: input.content_type });
        if (normalized.status !== "available") throw new Error("stored campaign document could not be normalized");
        return Object.freeze({
          document_id: ingest.document.document_id,
          source_id: source.source_id,
          family_key: ingest.document.provider_doc_id ?? ingest.document.document_id,
          title: input.title,
          url: input.url,
          published_at: input.published_at,
          retrieved_at: input.retrieved_at,
          document_hash: ingest.document.content_hash,
          normalized_text: normalized.text,
          primary: true,
          primary_eligible: true,
          claims: Object.freeze([]),
        });
      } catch (error) {
        await deleteSource(options.db, source.source_id);
        throw error;
      }
    },
  });
}

async function loadClaims(db: QueryExecutor, documentId: string, userId: string): Promise<readonly CampaignStoredDocumentClaim[]> {
  const { rows } = await db.query<{ claim_id: string; reporting_source_id: string; text_canonical: string }>(
    `select c.claim_id::text as claim_id, c.reported_by_source_id::text as reporting_source_id, c.text_canonical
       from claims c
       join sources s on s.source_id = c.reported_by_source_id
      where c.document_id = $1::uuid and (s.user_id is null or s.user_id = $2::uuid)
      order by c.claim_id`,
    [documentId, userId],
  );
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : isoRequired(value);
}

function isoRequired(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function requestHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function documentCapacity(value: number | undefined): number {
  const capacity = typeof value === "number" && Number.isInteger(value) ? value : MAX_DOCUMENTS_PER_COMPANY;
  return Math.min(Math.max(capacity, 0), MAX_DOCUMENTS_PER_COMPANY);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
