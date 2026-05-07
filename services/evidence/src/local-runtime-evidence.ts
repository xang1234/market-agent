import { createHash } from "node:crypto";

import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";

import { createClaim, type ClaimRow } from "./claim-repo.ts";
import { createClaimArgument } from "./claim-argument-repo.ts";
import { createClaimEvidence } from "./claim-evidence-repo.ts";
import { createDocument, type DocumentRow } from "./document-repo.ts";
import { createSource, type SourceRow } from "./source-repo.ts";
import { ephemeralRawBlobIdForSource } from "./object-store.ts";
import type { QueryExecutor } from "./types.ts";

export type LocalRuntimeEvidenceInput = {
  provider: string;
  title: string;
  summary: string;
  predicate: string;
  subject_refs: ReadonlyArray<SnapshotSubjectRef>;
  as_of: string;
  user_id?: string | null;
};

export type LocalRuntimeEvidence = {
  source: SourceRow;
  document: DocumentRow;
  claim: ClaimRow;
  source_ids: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  subject_refs: ReadonlyArray<SnapshotSubjectRef>;
  verifier_sources: ReadonlyArray<{ source_id: string }>;
  verifier_documents: ReadonlyArray<{ document_id: string; source_id: string }>;
  verifier_claims: ReadonlyArray<{ claim_id: string; source_id: string }>;
};

export async function createLocalRuntimeEvidence(
  db: QueryExecutor,
  input: LocalRuntimeEvidenceInput,
): Promise<LocalRuntimeEvidence> {
  const subjectRefs = input.subject_refs.length > 0 ? input.subject_refs : [];
  const source = await createSource(db, {
    provider: input.provider,
    kind: "internal",
    trust_tier: "user",
    license_class: "internal_runtime",
    retrieved_at: input.as_of,
    content_hash: contentHash([input.provider, input.title, input.summary, input.as_of].join("\n")),
    user_id: input.user_id ?? null,
  });
  const documentResult = await createDocument(db, {
    source_id: source.source_id,
    provider_doc_id: `${input.provider}:${source.source_id}`,
    kind: "research_note",
    title: input.title,
    published_at: input.as_of,
    lang: "en",
    content_hash: contentHash([source.source_id, input.title, input.summary].join("\n")),
    raw_blob_id: ephemeralRawBlobIdForSource(source.source_id),
    parse_status: "parsed",
  });
  const document = documentResult.document;
  const claim = await createClaim(db, {
    document_id: document.document_id,
    predicate: input.predicate,
    text_canonical: input.summary,
    polarity: "neutral",
    modality: "asserted",
    reported_by_source_id: source.source_id,
    effective_time: input.as_of,
    confidence: 0.72,
    status: "extracted",
  });

  for (const subject of subjectRefs) {
    await createClaimArgument(db, {
      claim_id: claim.claim_id,
      subject_kind: subject.kind,
      subject_id: subject.id,
      role: "subject",
    });
  }
  await createClaimEvidence(db, {
    claim_id: claim.claim_id,
    document_id: document.document_id,
    locator: {
      kind: "local_runtime_summary",
      provider: input.provider,
      title_hash: contentHash(input.title),
    },
    confidence: 0.72,
  });

  return Object.freeze({
    source,
    document,
    claim,
    source_ids: Object.freeze([source.source_id]),
    document_refs: Object.freeze([document.document_id]),
    claim_refs: Object.freeze([claim.claim_id]),
    subject_refs: Object.freeze([...subjectRefs]),
    verifier_sources: Object.freeze([{ source_id: source.source_id }]),
    verifier_documents: Object.freeze([{ document_id: document.document_id, source_id: source.source_id }]),
    verifier_claims: Object.freeze([{ claim_id: claim.claim_id, source_id: source.source_id }]),
  });
}

function contentHash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
