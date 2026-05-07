import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";

import type { QueryExecutor } from "./types.ts";

export type LocalRuntimeEvidenceInput = {
  subject_refs: ReadonlyArray<SnapshotSubjectRef>;
  user_id?: string | null;
  exclude_claim_ids?: ReadonlyArray<string>;
  limit?: number;
};

export type LocalRuntimeClaimEvidence = {
  claim_id: string;
  document_id: string;
  source_id: string;
  text_canonical: string;
  predicate: string;
  polarity: string;
  trust_tier: string;
  confidence: number;
  document_title: string | null;
  published_at: string | null;
  effective_time: string | null;
};

export type LocalRuntimeEvidence = {
  claims: ReadonlyArray<LocalRuntimeClaimEvidence>;
  source_ids: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  subject_refs: ReadonlyArray<SnapshotSubjectRef>;
  verifier_sources: ReadonlyArray<{ source_id: string }>;
  verifier_documents: ReadonlyArray<{ document_id: string; source_id: string }>;
  verifier_claims: ReadonlyArray<{ claim_id: string; source_id: string }>;
};

type ClaimEvidenceRow = {
  claim_id: string;
  document_id: string;
  source_id: string;
  text_canonical: string;
  predicate: string;
  polarity: string;
  trust_tier: string;
  confidence: number | string;
  document_title: string | null;
  published_at: Date | string | null;
  effective_time: Date | string | null;
};

type VerifierRows = {
  sources: ReadonlyArray<{ source_id: string }>;
  documents: ReadonlyArray<{ document_id: string; source_id: string }>;
  claims: ReadonlyArray<{ claim_id: string; source_id: string }>;
};

export async function loadLocalRuntimeEvidence(
  db: QueryExecutor,
  input: LocalRuntimeEvidenceInput,
): Promise<LocalRuntimeEvidence> {
  const subjectRefs = normalizeSubjectRefs(input.subject_refs);
  if (subjectRefs.length === 0) return emptyEvidence(subjectRefs);

  const excludedClaimIds = unique(input.exclude_claim_ids ?? []);
  const { rows } = await db.query<ClaimEvidenceRow>(
    `with subject_refs as (
       select kind::subject_kind as subject_kind,
              id::uuid as subject_id
         from jsonb_to_recordset($1::jsonb) as refs(kind text, id text)
     ),
     matching_claims as (
       select distinct on (c.claim_id)
              c.claim_id::text as claim_id,
              c.document_id::text as document_id,
              c.reported_by_source_id::text as source_id,
              c.text_canonical,
              c.predicate,
              c.polarity,
              s.trust_tier,
              c.confidence,
              d.title as document_title,
              d.published_at,
              c.effective_time,
              c.created_at as claim_created_at
         from subject_refs sr
         join claim_arguments ca
           on ca.subject_kind = sr.subject_kind
          and ca.subject_id = sr.subject_id
         join claims c
           on c.claim_id = ca.claim_id
         join documents d
           on d.document_id = c.document_id
         join sources s
           on s.source_id = c.reported_by_source_id
        where c.status in ('extracted', 'corroborated')
          and not (c.claim_id = any($4::uuid[]))
          and (
            s.user_id is null
            or ($3::uuid is not null and s.user_id = $3::uuid)
          )
        order by c.claim_id,
                 c.effective_time desc nulls last,
                 c.created_at desc
     )
     select claim_id,
            document_id,
            source_id,
            text_canonical,
            predicate,
            polarity,
            trust_tier,
            confidence,
            document_title,
            published_at,
            effective_time
       from matching_claims
      order by coalesce(effective_time, published_at, claim_created_at) desc nulls last,
               claim_id desc
      limit $2`,
    [JSON.stringify(subjectRefs), input.limit ?? 5, userIdOrNull(input.user_id), excludedClaimIds],
  );

  return evidenceFromClaimRows(subjectRefs, rows);
}

export async function loadVerifierRowsForRefs(
  db: QueryExecutor,
  input: {
    source_ids: ReadonlyArray<string>;
    document_refs: ReadonlyArray<string>;
    claim_refs: ReadonlyArray<string>;
  },
): Promise<VerifierRows> {
  const sourceIds = unique(input.source_ids);
  const documentIds = unique(input.document_refs);
  const claimIds = unique(input.claim_refs);

  const [sources, documents, claims] = await Promise.all([
    sourceIds.length === 0
      ? Promise.resolve({ rows: [] as Array<{ source_id: string }> })
      : db.query<{ source_id: string }>(
        `select source_id::text as source_id
           from sources
          where source_id = any($1::uuid[])`,
        [sourceIds],
      ),
    documentIds.length === 0
      ? Promise.resolve({ rows: [] as Array<{ document_id: string; source_id: string }> })
      : db.query<{ document_id: string; source_id: string }>(
        `select document_id::text as document_id,
                source_id::text as source_id
           from documents
          where document_id = any($1::uuid[])`,
        [documentIds],
      ),
    claimIds.length === 0
      ? Promise.resolve({ rows: [] as Array<{ claim_id: string; source_id: string }> })
      : db.query<{ claim_id: string; source_id: string }>(
        `select claim_id::text as claim_id,
                reported_by_source_id::text as source_id
           from claims
          where claim_id = any($1::uuid[])`,
        [claimIds],
      ),
  ]);

  return Object.freeze({
    sources: Object.freeze(sources.rows.map((row) => Object.freeze({ source_id: row.source_id }))),
    documents: Object.freeze(
      documents.rows.map((row) => Object.freeze({ document_id: row.document_id, source_id: row.source_id })),
    ),
    claims: Object.freeze(claims.rows.map((row) => Object.freeze({ claim_id: row.claim_id, source_id: row.source_id }))),
  });
}

function evidenceFromClaimRows(
  subjectRefs: ReadonlyArray<SnapshotSubjectRef>,
  rows: ReadonlyArray<ClaimEvidenceRow>,
): LocalRuntimeEvidence {
  const claims = rows.map((row) =>
    Object.freeze({
      claim_id: row.claim_id,
      document_id: row.document_id,
      source_id: row.source_id,
      text_canonical: row.text_canonical,
      predicate: row.predicate,
      polarity: row.polarity,
      trust_tier: row.trust_tier,
      confidence: Number(row.confidence),
      document_title: row.document_title,
      published_at: row.published_at == null ? null : isoString(row.published_at),
      effective_time: row.effective_time == null ? null : isoString(row.effective_time),
    }),
  );
  const sourceIds = unique(claims.map((claim) => claim.source_id));
  const documentRefs = unique(claims.map((claim) => claim.document_id));
  const claimRefs = unique(claims.map((claim) => claim.claim_id));

  return Object.freeze({
    claims: Object.freeze(claims),
    source_ids: Object.freeze(sourceIds),
    document_refs: Object.freeze(documentRefs),
    claim_refs: Object.freeze(claimRefs),
    subject_refs: Object.freeze([...subjectRefs]),
    verifier_sources: Object.freeze(sourceIds.map((source_id) => Object.freeze({ source_id }))),
    verifier_documents: Object.freeze(
      claims.map((claim) => Object.freeze({ document_id: claim.document_id, source_id: claim.source_id })),
    ),
    verifier_claims: Object.freeze(claims.map((claim) => Object.freeze({ claim_id: claim.claim_id, source_id: claim.source_id }))),
  });
}

function emptyEvidence(subjectRefs: ReadonlyArray<SnapshotSubjectRef>): LocalRuntimeEvidence {
  return Object.freeze({
    claims: Object.freeze([]),
    source_ids: Object.freeze([]),
    document_refs: Object.freeze([]),
    claim_refs: Object.freeze([]),
    subject_refs: Object.freeze([...subjectRefs]),
    verifier_sources: Object.freeze([]),
    verifier_documents: Object.freeze([]),
    verifier_claims: Object.freeze([]),
  });
}

function normalizeSubjectRefs(refs: ReadonlyArray<SnapshotSubjectRef>): ReadonlyArray<SnapshotSubjectRef> {
  return Object.freeze(
    refs.filter((ref) => isUuid(ref.id)).map((ref) => Object.freeze({ kind: ref.kind, id: ref.id })),
  );
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.filter(isUuid))];
}

function userIdOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && isUuid(value) ? value : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
