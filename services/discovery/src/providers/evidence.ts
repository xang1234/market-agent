import { createHash } from "node:crypto";

import type { CampaignDocument } from "../../../evidence/src/campaign-documents.ts";
import type { EvidencePacket, EvidenceProvider, OperationRunner } from "../ports.ts";
import type { Brief, DiscoveredCandidate } from "../types.ts";

const MAX_DOCUMENTS = 6;
const MAX_CHARS_PER_DOCUMENT = 8_000;
const MAX_PACKET_CHARS = 48_000;
const PRIMARY_MAX_AGE_MS = 24 * 30 * 24 * 60 * 60 * 1_000;

export type VerifiedDocumentCandidate = {
  url: string;
  title: string;
  published_at: string | null;
  provider: "sec_edgar" | "issuer_ir";
  kind: "filing" | "press_release" | "transcript";
  ir_source_id?: string;
};
export type CampaignDocumentService = {
  load(input: { issuer_id: string; limit?: number }): Promise<{ documents: readonly CampaignDocument[]; coverage_gaps: readonly string[] }>;
  fetchAndStore(input: VerifiedDocumentCandidate & {
    issuer_id: string;
    operation_key: string;
    request_hash: string;
    phase: "discovery" | "research" | "verification";
    candidate_id?: string;
  }, operations: OperationRunner): Promise<CampaignDocument>;
};
export type PrimaryDocumentCandidateFinder = {
  find(input: {
    candidate: DiscoveredCandidate;
    as_of: string;
    operation_key: string;
    request_hash: string;
    phase: "discovery" | "research" | "verification";
    remaining_capacity?: number;
  }, operations: OperationRunner): Promise<readonly VerifiedDocumentCandidate[]>;
};
export type SourcePrimaryDocumentCandidateFinder = {
  find(input: {
    issuer_id: string;
    operation_key: string;
    request_hash: string;
    candidate_id: string;
    phase: "discovery" | "research" | "verification";
    remaining_capacity?: number;
  }, operations: OperationRunner): Promise<readonly VerifiedDocumentCandidate[]>;
};

export function createPrimaryDocumentCandidateFinder(options: {
  sec?: SourcePrimaryDocumentCandidateFinder;
  issuer_ir?: SourcePrimaryDocumentCandidateFinder;
}): PrimaryDocumentCandidateFinder {
  return Object.freeze({
    async find(input, operations) {
      const identity = input.candidate.identity;
      if (!identity) return Object.freeze([]);
      const request = {
        issuer_id: identity.issuer_id,
        operation_key: input.operation_key,
        request_hash: input.request_hash,
        candidate_id: input.candidate.candidate_id,
        phase: input.phase,
        remaining_capacity: documentCapacity(input.remaining_capacity),
      };
      const sec = options.sec ? (await options.sec.find(request, operations)).slice(0, request.remaining_capacity) : [];
      const remainingCapacity = request.remaining_capacity - sec.length;
      const issuerIr = remainingCapacity > 0 && options.issuer_ir
        ? await options.issuer_ir.find({ ...request, remaining_capacity: remainingCapacity }, operations)
        : [];
      return Object.freeze([...sec, ...issuerIr].slice(0, request.remaining_capacity));
    },
  });
}

export function createEvidenceProvider(options: {
  documents: CampaignDocumentService;
  candidates?: PrimaryDocumentCandidateFinder;
}): EvidenceProvider {
  return Object.freeze({
    async acquire(input, operations): Promise<EvidencePacket> {
      const identity = input.candidate.identity;
      if (!identity) throw new Error("cannot acquire evidence for an unresolved identity");
      const loaded = await options.documents.load({ issuer_id: identity.issuer_id, limit: MAX_DOCUMENTS });
      const documents = [...loaded.documents];
      if (options.candidates && documents.length < MAX_DOCUMENTS) {
        const candidates = await options.candidates.find({
          candidate: input.candidate,
          as_of: input.as_of,
          operation_key: input.operation_key,
          request_hash: input.request_hash,
          phase: input.phase,
          remaining_capacity: MAX_DOCUMENTS - documents.length,
        }, operations);
        for (const [index, candidate] of candidates.entries()) {
          if (documents.length >= MAX_DOCUMENTS) break;
          const document = await options.documents.fetchAndStore({
            ...candidate,
            issuer_id: identity.issuer_id,
            operation_key: `${input.operation_key}/document/${index}`,
            request_hash: requestHash({ candidate, base: input.request_hash }),
            phase: input.phase,
            candidate_id: input.candidate_id ?? input.candidate.candidate_id,
          }, operations);
          documents.push(document);
        }
      }
      const bounded = documents.slice(0, MAX_DOCUMENTS);
      const excerpts = makeExcerpts(bounded, input.brief, input.as_of);
      const gaps = [...loaded.coverage_gaps, ...primaryGaps(bounded, input.as_of)];
      return {
        candidate_id: input.candidate.candidate_id,
        identity,
        excerpts,
        claims: uniqueClaims(bounded),
        facts: [],
        counter_search_completed: false,
        coverage_gaps: [...new Set(gaps)],
      };
    },
  });
}

function documentCapacity(value: number | undefined): number {
  const capacity = typeof value === "number" && Number.isInteger(value) ? value : MAX_DOCUMENTS;
  return Math.min(Math.max(capacity, 0), MAX_DOCUMENTS);
}

function makeExcerpts(documents: readonly CampaignDocument[], brief: Brief, asOf: string): EvidencePacket["excerpts"] {
  const terms = queryTerms(brief);
  let remaining = MAX_PACKET_CHARS;
  const excerpts: EvidencePacket["excerpts"] = [];
  for (const document of documents) {
    if (remaining <= 0) break;
    const window = queryWindow(document.normalized_text, terms, Math.min(MAX_CHARS_PER_DOCUMENT, remaining));
    if (!window) continue;
    excerpts.push(Object.freeze({
      excerpt_id: stableUuid(`${document.document_id}\u0000${window.start}\u0000${window.text}`),
      document_id: document.document_id,
      source_id: document.source_id,
      family_key: document.family_key,
      title: document.title,
      url: document.url,
      published_at: document.published_at,
      retrieved_at: document.retrieved_at,
      document_hash: document.document_hash,
      normalized_start: window.start,
      text: window.text,
      primary: document.primary,
      primary_eligible: document.primary_eligible && isCurrentPrimary(document, asOf),
    }));
    remaining -= window.text.length;
  }
  return excerpts;
}

function queryTerms(brief: Brief): readonly string[] {
  return Object.freeze([...new Set([
    ...brief.queries.map((query) => query.query),
    brief.question,
    ...brief.mechanisms.flatMap((mechanism) => mechanism.chain),
  ].flatMap((text) => text.toLocaleLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/gu) ?? []))].slice(0, 32));
}

function queryWindow(text: string, terms: readonly string[], maxLength: number): { start: number; text: string } | null {
  const lower = text.toLocaleLowerCase();
  const positions = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  if (positions.length === 0) return null;
  const match = Math.min(...positions);
  const start = Math.max(0, match - 2_000);
  return { start, text: text.slice(start, start + maxLength) };
}

function primaryGaps(documents: readonly CampaignDocument[], asOf: string): string[] {
  const primary = documents.filter((document) => document.primary && document.primary_eligible);
  if (primary.length === 0) return ["primary_evidence_missing"];
  if (primary.some((document) => document.published_at === null)) return ["primary_evidence_publication_unknown"];
  if (!primary.some((document) => isCurrentPrimary(document, asOf))) return ["primary_evidence_stale"];
  return [];
}

function isCurrentPrimary(document: CampaignDocument, asOf: string): boolean {
  if (!document.published_at) return false;
  const published = Date.parse(document.published_at);
  const now = Date.parse(asOf);
  return Number.isFinite(published) && Number.isFinite(now) && now - published <= PRIMARY_MAX_AGE_MS;
}

function uniqueClaims(documents: readonly CampaignDocument[]): EvidencePacket["claims"] {
  const claims = new Map<string, EvidencePacket["claims"][number]>();
  for (const document of documents) {
    for (const claim of document.claims) {
      claims.set(claim.claim_id, Object.freeze({
        claim_id: claim.claim_id,
        document_id: document.document_id,
        source_id: claim.source_id,
        text_canonical: claim.text_canonical,
      }));
    }
  }
  return [...claims.values()];
}

function requestHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const raw = hex.join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}
