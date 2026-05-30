import { assertSubjectRef, type SubjectRef } from "../../shared/src/subject-ref.ts";
import { createClaimArgument } from "./claim-argument-repo.ts";
import { createClaimEvidence } from "./claim-evidence-repo.ts";
import { createClaim, type ClaimRow } from "./claim-repo.ts";
import type { DocumentRow } from "./document-repo.ts";
import { createEvent, createEventSubject, type EventRow } from "./event-repo.ts";
import {
  documentTextFromBytes,
  extractIssuerIrEvidence,
} from "./issuer-ir-extraction.ts";
import {
  createIrDocumentAsset,
  findIrDocumentAssetByIssuerUrl,
  recordIrSourceCrawlFailure,
  recordIrSourceCrawlSuccess,
  type IrDocumentAssetRow,
  type IrSourceRegistryRow,
} from "./issuer-ir-registry.ts";
import { ingestDocument, type IngestDocumentResult } from "./ingest.ts";
import { createMention } from "./mention-repo.ts";
import {
  ingestEarningsTranscript,
  ingestPressRelease,
} from "./news-ingest.ts";
import type { ObjectStore } from "./object-store.ts";
import {
  discoverIssuerIrCandidates,
  fetchIssuerIrDocumentBytes,
  type DiscoverIssuerIrCandidatesConfig,
  type IssuerIrCandidate,
} from "./providers/issuer-ir.ts";
import {
  createSource,
  deleteSource,
  type SourceRow,
} from "./source-repo.ts";
import type { QueryExecutor } from "./types.ts";
import {
  assertNonEmptyString,
} from "./validators.ts";

export type IngestIssuerIrSourceDeps = DiscoverIssuerIrCandidatesConfig & {
  db: QueryExecutor;
  objectStore: ObjectStore;
};

export type IngestIssuerIrSourceInput = {
  registryEntry: IrSourceRegistryRow;
  issuerName: string;
  subjectRef: SubjectRef;
};

export type IssuerIrIngestRecord = Readonly<{
  candidate: IssuerIrCandidate;
  source: SourceRow;
  document: DocumentRow;
  ingest: IngestDocumentResult | null;
  asset: IrDocumentAssetRow;
  claims: ReadonlyArray<ClaimRow>;
  events: ReadonlyArray<EventRow>;
  status: "created" | "already_present";
}>;

export type IngestIssuerIrSourceResult = Readonly<{
  records: ReadonlyArray<IssuerIrIngestRecord>;
  skipped: ReadonlyArray<Readonly<{ candidate: IssuerIrCandidate; reason: "already_present" | "empty_body" }>>;
}>;

export async function ingestIssuerIrSource(
  deps: IngestIssuerIrSourceDeps,
  input: IngestIssuerIrSourceInput,
): Promise<IngestIssuerIrSourceResult> {
  validateInput(input);
  const crawledAt = new Date(deps.now?.() ?? Date.now()).toISOString();
  try {
    const candidates = await discoverIssuerIrCandidates(input.registryEntry, deps);
    const records: IssuerIrIngestRecord[] = [];
    const skipped: Array<{ candidate: IssuerIrCandidate; reason: "already_present" | "empty_body" }> = [];
    for (const candidate of candidates) {
      const existing = await findIrDocumentAssetByIssuerUrl(
        deps.db,
        input.registryEntry.issuer_id,
        candidate.canonicalUrl,
      );
      if (existing) {
        skipped.push({ candidate, reason: "already_present" });
        continue;
      }
      const fetched = await fetchIssuerIrDocumentBytes(candidate.canonicalUrl, deps);
      if (fetched.bytes.byteLength === 0) {
        skipped.push({ candidate, reason: "empty_body" });
        continue;
      }
      records.push(await persistIssuerIrCandidate(deps, input, candidate, {
        bytes: fetched.bytes,
        contentType: fetched.contentType ?? candidate.contentType,
        fetchedAt: fetched.retrievedAt,
      }));
    }
    await recordIrSourceCrawlSuccess(deps.db, {
      ir_source_id: input.registryEntry.ir_source_id,
      crawled_at: crawledAt,
    });
    return Object.freeze({
      records: Object.freeze(records),
      skipped: Object.freeze(skipped.map((item) => Object.freeze(item))),
    });
  } catch (error) {
    await recordIrSourceCrawlFailure(deps.db, {
      ir_source_id: input.registryEntry.ir_source_id,
      crawled_at: crawledAt,
      error: errorMessage(error),
    });
    throw error;
  }
}

async function persistIssuerIrCandidate(
  deps: IngestIssuerIrSourceDeps,
  input: IngestIssuerIrSourceInput,
  candidate: IssuerIrCandidate,
  fetched: { bytes: Uint8Array; contentType: string | null; fetchedAt: string },
): Promise<IssuerIrIngestRecord> {
  const provider = sourceProvider(candidate);
  const licenseClass = provider === "issuer_ir" ? "public" : "free";
  let source: SourceRow;
  let ingest: IngestDocumentResult;
  if (candidate.assetKind === "press_release") {
    const result = await ingestPressRelease(deps, {
      bytes: fetched.bytes,
      provider,
      canonicalUrl: candidate.canonicalUrl,
      publisher: input.issuerName,
      publishedAt: candidate.publishedAt ?? fetched.fetchedAt,
      title: candidate.title,
      trustTier: provider === "issuer_ir" ? "primary" : "secondary",
      licenseClass,
      retrievedAt: fetched.fetchedAt,
      providerDocId: providerDocId(candidate),
    });
    source = result.source;
    ingest = result.ingest;
  } else if (candidate.assetKind === "transcript") {
    const result = await ingestEarningsTranscript(deps, {
      bytes: fetched.bytes,
      provider,
      canonicalUrl: candidate.canonicalUrl,
      publisher: input.issuerName,
      publishedAt: candidate.publishedAt ?? fetched.fetchedAt,
      fiscalPeriod: inferFiscalPeriod(candidate.title, candidate.publishedAt ?? fetched.fetchedAt),
      issuer: input.issuerName,
      trustTier: provider === "issuer_ir" ? "secondary" : "tertiary",
      licenseClass: provider === "issuer_ir" ? "public" : "licensed",
      retrievedAt: fetched.fetchedAt,
      providerDocId: providerDocId(candidate),
    });
    source = result.source;
    ingest = result.ingest;
  } else {
    const result = await ingestPresentation(deps, {
      candidate,
      bytes: fetched.bytes,
      provider,
      licenseClass,
      issuerName: input.issuerName,
      retrievedAt: fetched.fetchedAt,
    });
    source = result.source;
    ingest = result.ingest;
  }

  const document = ingest.document;
  const asset = await createIrDocumentAsset(deps.db, {
    ir_source_id: input.registryEntry.ir_source_id,
    issuer_id: input.registryEntry.issuer_id,
    document_id: document.document_id,
    source_id: source.source_id,
    asset_kind: candidate.assetKind,
    canonical_url: candidate.canonicalUrl,
    hosted_provider: candidate.hostedProvider,
    issuer_attested: provider === "issuer_ir",
    content_type: fetched.contentType,
    discovered_at: candidate.publishedAt ?? fetched.fetchedAt,
    fetched_at: fetched.fetchedAt,
  });
  await createMention(deps.db, {
    document_id: document.document_id,
    subject_kind: input.subjectRef.kind,
    subject_id: input.subjectRef.id,
    prominence: candidate.assetKind === "press_release" ? "headline" : "lead",
    mention_count: 1,
    confidence: provider === "issuer_ir" ? 0.95 : 0.82,
  });
  const extracted = extractIssuerIrEvidence({
    text: documentTextFromBytes(fetched.bytes, candidate.assetKind),
    document_id: document.document_id,
    source_id: source.source_id,
    subject_ref: input.subjectRef,
    asset,
    effective_time: candidate.publishedAt ?? fetched.fetchedAt,
  });
  const claims = await persistClaims(deps.db, extracted.claims, input.subjectRef);
  const events = await persistEvents(deps.db, extracted.events, input.subjectRef, claims.map((claim) => claim.claim_id));
  return Object.freeze({
    candidate,
    source,
    document,
    ingest,
    asset,
    claims,
    events,
    status: "created" as const,
  });
}

async function ingestPresentation(
  deps: IngestIssuerIrSourceDeps,
  input: {
    candidate: IssuerIrCandidate;
    bytes: Uint8Array;
    provider: string;
    licenseClass: string;
    issuerName: string;
    retrievedAt: string;
  },
): Promise<{ source: SourceRow; ingest: IngestDocumentResult }> {
  const source = await createSource(deps.db, {
    provider: input.provider,
    kind: "research_note",
    canonical_url: input.candidate.canonicalUrl,
    trust_tier: input.provider === "issuer_ir" ? "primary" : "secondary",
    license_class: input.licenseClass,
    retrieved_at: input.retrievedAt,
  });
  try {
    const ingest = await ingestDocument(deps, {
      source: { source_id: source.source_id, license_class: source.license_class },
      bytes: input.bytes,
      document: {
        provider_doc_id: providerDocId(input.candidate),
        kind: "research_note",
        title: input.candidate.title,
        author: input.issuerName,
        published_at: input.candidate.publishedAt ?? input.retrievedAt,
      },
    });
    return Object.freeze({ source, ingest });
  } catch (error) {
    await deleteSource(deps.db, source.source_id);
    throw error;
  }
}

async function persistClaims(
  db: QueryExecutor,
  claims: readonly Parameters<typeof createClaim>[1][],
  subjectRef: SubjectRef,
): Promise<readonly ClaimRow[]> {
  const rows: ClaimRow[] = [];
  for (const claimInput of claims) {
    const claim = await createClaim(db, claimInput);
    await createClaimArgument(db, {
      claim_id: claim.claim_id,
      subject_kind: subjectRef.kind,
      subject_id: subjectRef.id,
      role: "subject",
    });
    await createClaimEvidence(db, {
      claim_id: claim.claim_id,
      document_id: claim.document_id,
      locator: {
        kind: "issuer_ir_rule",
        predicate: claim.predicate,
      },
      confidence: claim.confidence,
    });
    rows.push(claim);
  }
  return Object.freeze(rows);
}

async function persistEvents(
  db: QueryExecutor,
  events: readonly Parameters<typeof createEvent>[1][],
  subjectRef: SubjectRef,
  claimIds: readonly string[],
): Promise<readonly EventRow[]> {
  const rows: EventRow[] = [];
  for (const eventInput of events) {
    const event = await createEvent(db, {
      ...eventInput,
      source_claim_ids: claimIds,
    });
    await createEventSubject(db, {
      event_id: event.event_id,
      subject_kind: subjectRef.kind,
      subject_id: subjectRef.id,
      role: "subject",
    });
    rows.push(event);
  }
  return Object.freeze(rows);
}

function sourceProvider(candidate: IssuerIrCandidate): string {
  return candidate.hostedProvider === "issuer_ir" || candidate.hostedProvider === "q4cdn" || candidate.hostedProvider === "notified"
    ? "issuer_ir"
    : candidate.hostedProvider;
}

function providerDocId(candidate: IssuerIrCandidate): string {
  return `issuer_ir:${candidate.assetKind}:${candidate.canonicalUrl}`;
}

function inferFiscalPeriod(title: string, fallbackDate: string): string {
  const quarterBeforeYear = /\b(?:q([1-4])|([1-4])q)\s*(20\d{2})\b/i.exec(title);
  if (quarterBeforeYear) return `${quarterBeforeYear[3]}Q${quarterBeforeYear[1] ?? quarterBeforeYear[2]}`;
  const yearBeforeQuarter = /\b(20\d{2})\s*(?:q([1-4])|([1-4])q)\b/i.exec(title);
  if (yearBeforeQuarter) return `${yearBeforeQuarter[1]}Q${yearBeforeQuarter[2] ?? yearBeforeQuarter[3]}`;
  const year = new Date(fallbackDate).getUTCFullYear();
  return Number.isFinite(year) ? `${year}FY` : "unknown";
}

function validateInput(input: IngestIssuerIrSourceInput): void {
  assertNonEmptyString(input.issuerName, "issuerName");
  assertSubjectRef(input.subjectRef, "subjectRef");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
