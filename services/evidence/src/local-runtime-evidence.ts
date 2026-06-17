import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import type { VerifierFact } from "../../snapshot/src/snapshot-verifier.ts";

import { sourceDisclosure } from "./source-disclosure.ts";
import type { QueryExecutor } from "./types.ts";

export type LocalRuntimeEvidenceInput = {
  subject_refs: ReadonlyArray<SnapshotSubjectRef>;
  user_id?: string | null;
  exclude_claim_ids?: ReadonlyArray<string>;
  source_categories?: ReadonlyArray<string>;
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
  license_class: string;
  provider: string;
  source_canonical_url: string | null;
  source_disclosure: string | null;
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
  license_class: string;
  provider: string;
  source_canonical_url: string | null;
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
  const sourceCategories = input.source_categories ?? null;
  const includeIssuerIr = (sourceCategories ?? []).includes("issuer_ir");
  const includeNonIr = sourceCategories === null || sourceCategories.some((category) => category !== "issuer_ir");
  const { rows } = await db.query<ClaimEvidenceRow>(
    `with input_refs as (
       select kind::subject_kind as subject_kind,
              id::uuid as subject_id
         from jsonb_to_recordset($1::jsonb) as refs(kind text, id text)
     ),
     subject_refs as (
       -- ADR 0001: also match claims attributed to the ISSUER behind a
       -- listing/instrument universe ref. Evidence (SEC filings, issuer IR,
       -- news) is issuer-scoped, but agent universes are usually listing-scoped,
       -- so an exact (kind, id) match silently misses issuer-attributed claims.
       -- The original refs still match; union dedupes. This is the AUGMENT
       -- sibling of analyst-grids' normalizeUniverseToIssuers (which REPLACES
       -- listing/instrument->issuer for issuer-scoped grid columns); a shared
       -- subject->issuer module should unify both and the inline
       -- listings/instruments joins — see fra-t2j6.
       select subject_kind, subject_id from input_refs
       union
       select 'issuer'::subject_kind as subject_kind, ins.issuer_id as subject_id
         from input_refs ir
         join listings l on l.listing_id = ir.subject_id
         join instruments ins on ins.instrument_id = l.instrument_id
        where ir.subject_kind = 'listing'
       union
       select 'issuer'::subject_kind as subject_kind, ins.issuer_id as subject_id
         from input_refs ir
         join instruments ins on ins.instrument_id = ir.subject_id
        where ir.subject_kind = 'instrument'
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
              s.license_class,
              s.provider,
              s.canonical_url as source_canonical_url,
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
          and c.superseded_at is null
          and not (c.claim_id = any($4::uuid[]))
          and (
            s.user_id is null
            or ($3::uuid is not null and s.user_id = $3::uuid)
          )
          and (
            (
              $5::boolean = true
              and exists (
                select 1
                  from ir_document_assets ira
                 where ira.document_id = d.document_id
              )
            )
            or (
              $6::boolean = true
              and not exists (
                select 1
                  from ir_document_assets ira
                 where ira.document_id = d.document_id
              )
            )
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
            license_class,
            provider,
            source_canonical_url,
            confidence,
            document_title,
            published_at,
            effective_time
       from matching_claims
      order by coalesce(effective_time, published_at, claim_created_at) desc nulls last,
               claim_id desc
      limit $2`,
    [
      JSON.stringify(subjectRefs),
      input.limit ?? 5,
      userIdOrNull(input.user_id),
      excludedClaimIds,
      includeIssuerIr,
      includeNonIr,
    ],
  );

  return evidenceFromClaimRows(subjectRefs, rows);
}

export async function loadVerifierRowsForRefs(
  db: QueryExecutor,
  input: {
    source_ids: ReadonlyArray<string>;
    document_refs: ReadonlyArray<string>;
    claim_refs: ReadonlyArray<string>;
    user_id?: string | null;
  },
): Promise<VerifierRows> {
  const sourceIds = unique(input.source_ids);
  const documentIds = unique(input.document_refs);
  const claimIds = unique(input.claim_refs);
  const userId = userIdOrNull(input.user_id);

  const sources = sourceIds.length === 0
    ? { rows: [] as Array<{ source_id: string }> }
    : await db.query<{ source_id: string }>(
      `select source_id::text as source_id
         from sources
        where source_id = any($1::uuid[])
          and (user_id is null or ($2::uuid is not null and user_id = $2::uuid))`,
      [sourceIds, userId],
    );
  const documents = documentIds.length === 0
    ? { rows: [] as Array<{ document_id: string; source_id: string }> }
    : await db.query<{ document_id: string; source_id: string }>(
      `select document_id::text as document_id,
              d.source_id::text as source_id
         from documents d
         join sources s
           on s.source_id = d.source_id
        where d.document_id = any($1::uuid[])
          and (s.user_id is null or ($2::uuid is not null and s.user_id = $2::uuid))`,
      [documentIds, userId],
    );
  // Rehydration by id for a snapshot's claim_refs: deliberately does NOT filter
  // superseded_at — a sealed snapshot may cite a since-superseded claim (a Form 4/A
  // supersede, fra-28yi), and dropping it here would cause verifier missing_claim_ref.
  // Fresh subject->claims selection (matching_claims, above) filters it; this must not.
  const claims = claimIds.length === 0
    ? { rows: [] as Array<{ claim_id: string; source_id: string }> }
    : await db.query<{ claim_id: string; source_id: string }>(
      `select claim_id::text as claim_id,
              c.reported_by_source_id::text as source_id
         from claims c
         join sources s
           on s.source_id = c.reported_by_source_id
        where c.claim_id = any($1::uuid[])
          and (s.user_id is null or ($2::uuid is not null and s.user_id = $2::uuid))`,
      [claimIds, userId],
    );

  return Object.freeze({
    sources: Object.freeze(sources.rows.map((row) => Object.freeze({ source_id: row.source_id }))),
    documents: Object.freeze(
      documents.rows.map((row) => Object.freeze({ document_id: row.document_id, source_id: row.source_id })),
    ),
    claims: Object.freeze(claims.rows.map((row) => Object.freeze({ claim_id: row.claim_id, source_id: row.source_id }))),
  });
}

// Loads the facts the snapshot verifier needs for manifest.fact_refs. The chat
// seal cites fundamentals facts (fra-eegq) but never loaded them; this is the
// fact-side sibling of loadVerifierRowsForRefs. No user filter: the fact_ids are
// already entitlement-scoped to the caller (they came from the user's structured
// context), and the verifier rejects any fact whose source the user-filtered
// source load did not surface — so the source load is the entitlement gate.
export async function loadVerifierFactsForRefs(
  db: QueryExecutor,
  input: { fact_refs: ReadonlyArray<string> },
): Promise<ReadonlyArray<VerifierFact>> {
  const factIds = unique(input.fact_refs);
  if (factIds.length === 0) return Object.freeze([]);
  const { rows } = await db.query<{
    fact_id: string;
    source_id: string;
    unit: string | null;
    period_kind: string | null;
    period_start: string | null;
    period_end: string | null;
    fiscal_year: number | null;
    fiscal_period: string | null;
  }>(
    `select fact_id::text as fact_id,
            source_id::text as source_id,
            unit,
            period_kind,
            period_start::text as period_start,
            period_end::text as period_end,
            fiscal_year,
            fiscal_period
       from facts
      where fact_id = any($1::uuid[])
        and superseded_by is null
        and invalidated_at is null`,
    [factIds],
  );
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        fact_id: row.fact_id,
        source_id: row.source_id,
        unit: row.unit ?? undefined,
        period_kind: row.period_kind ?? undefined,
        period_start: row.period_start,
        period_end: row.period_end,
        fiscal_year: row.fiscal_year,
        fiscal_period: row.fiscal_period,
      }),
    ),
  );
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
      license_class: row.license_class,
      provider: row.provider,
      source_canonical_url: row.source_canonical_url,
      source_disclosure: sourceDisclosure({
        provider: row.provider,
        license_class: row.license_class,
      }),
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

export function emptyEvidence(subjectRefs: ReadonlyArray<SnapshotSubjectRef>): LocalRuntimeEvidence {
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
