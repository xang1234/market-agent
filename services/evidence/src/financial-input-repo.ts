// Authorized candidate reads for verified-finance input binding.
//
// Access rules run in SQL before any metadata is returned: owner visibility
// (public sources, plus the owner's private sources only when the caller asks
// for owner-visible scope), entitlement channel, invalidation, and promotion
// (authoritative/corroborated reported values, or promoted extractions).
// Estimated, vendor, and derived facts never become candidates. Superseded
// facts are returned — historical selection decides eligibility at a cutoff —
// and numerics are projected as text; no value passes through Number.

import type { FactEntitlementChannel } from "./fact-repo.ts";
import type { FactFinancialContext } from "./financial-context.ts";
import type { QueryExecutor } from "./types.ts";
import { assertNonEmptyString, assertOneOf, assertUuidV4 } from "./validators.ts";

export const FINANCIAL_CANDIDATE_LIMIT = 10_000;

/**
 * public_information: public sources only (the verified-finance historical
 * mode never admits private facts). owner_visible: public plus the owner's own.
 */
export type CandidateScope = "public_information" | "owner_visible";

export type FinancialCandidateRequest = Readonly<{
  user_id: string;
  channel: FactEntitlementChannel;
  scope: CandidateScope;
  subject: Readonly<{ kind: "issuer" | "listing"; id: string }>;
  metric_key: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  limit: number;
}>;

export type PublicationProof = Readonly<{
  attestation_id: string;
  available_not_before: string | null;
  available_no_later_than: string;
  timing_precision: "instant" | "date" | "observed_public";
  source_timezone: string;
  proof_method: string;
  mapping_version: string;
}>;

export type PrecisionProof = Readonly<{
  precision_attestation_id: string;
  precision_class: "source_token_preserved" | "revalidated_against_source" | "legacy_unverified";
  raw_token: string | null;
  token_proof_hash: string | null;
  value_text: string | null;
  scale_text: string | null;
  source_locator: string | null;
}>;

export type FinancialInputCandidate = Readonly<{
  fact_id: string;
  metric_key: string;
  period_kind: string;
  period_start: string | null;
  period_end: string | null;
  fiscal_year: number | null;
  fiscal_period: string | null;
  value_text: string;
  scale_text: string;
  unit: string;
  currency: string | null;
  method: "reported" | "extracted";
  verification_status: "authoritative" | "corroborated";
  reported_at: string | null;
  observed_at: string;
  supersedes: string | null;
  superseded_by: string | null;
  source_id: string;
  source_version_hash: string | null;
  context: Omit<FactFinancialContext, "fact_id"> | null;
  precision: PrecisionProof | null;
  /** Current (non-superseded) proofs for this exact source version only. */
  publication: ReadonlyArray<PublicationProof>;
}>;

export type FinancialCandidatePage = Readonly<{ candidates: ReadonlyArray<FinancialInputCandidate>; truncated: boolean }>;

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/**
 * Returns the authorized candidates for one subject/metric (optionally one
 * fiscal period). An inaccessible subject and a subject with no facts return
 * the same empty page: no counts or metadata leak across owners.
 */
export async function listFinancialInputCandidates(db: QueryExecutor, request: FinancialCandidateRequest): Promise<FinancialCandidatePage> {
  assertUuidV4(request.user_id, "user_id");
  assertOneOf(request.channel, ["app", "export", "email", "push"] as const, "channel");
  assertOneOf(request.scope, ["public_information", "owner_visible"] as const, "scope");
  assertOneOf(request.subject.kind, ["issuer", "listing"] as const, "subject.kind");
  assertUuidV4(request.subject.id, "subject.id");
  assertNonEmptyString(request.metric_key, "metric_key");
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > FINANCIAL_CANDIDATE_LIMIT) {
    throw new RangeError(`limit must be an integer from 1 to ${FINANCIAL_CANDIDATE_LIMIT}`);
  }

  const result = await db.query<Record<string, unknown>>(
    `select f.fact_id::text, m.metric_key, f.period_kind, f.period_start::text, f.period_end::text, f.fiscal_year, f.fiscal_period,
            f.value_num::text as value_text, f.scale::text as scale_text, f.unit, f.currency, f.method::text, f.verification_status::text,
            to_char(f.reported_at at time zone 'UTC', ${ISO_UTC}) as reported_at,
            to_char(f.observed_at at time zone 'UTC', ${ISO_UTC}) as observed_at,
            f.supersedes::text, f.superseded_by::text, f.source_id::text,
            nullif(regexp_replace(coalesce(s.content_hash, ''), '^sha256:', ''), '') as source_version_hash,
            ctx.context, prec.precision, coalesce(pub.publication, '[]'::jsonb) as publication
       from facts f
       join metrics m on m.metric_id = f.metric_id
       join sources s on s.source_id = f.source_id
       left join lateral (
         select jsonb_build_object(
                  'context_version', c.context_version, 'period_type', c.period_type, 'dimension_scope', c.dimension_scope,
                  'dimension_members', c.dimension_members, 'reporting_basis', c.reporting_basis, 'adjustment_basis', c.adjustment_basis,
                  'share_basis', c.share_basis, 'fiscal_calendar_version', c.fiscal_calendar_version,
                  'disclosure_relation', c.disclosure_relation, 'source_context_ref', c.source_context_ref) as context
           from fact_financial_contexts c where c.fact_id = f.fact_id
       ) ctx on true
       left join lateral (
         select jsonb_build_object(
                  'precision_attestation_id', a.precision_attestation_id::text, 'precision_class', a.precision_class,
                  'raw_token', a.raw_token, 'token_proof_hash', a.token_proof_hash, 'value_text', a.value_text,
                  'scale_text', a.scale_text, 'source_locator', a.source_locator) as precision
           from fact_precision_attestations a
          where a.fact_id = f.fact_id
            and not exists (select 1 from fact_precision_attestations newer where newer.supersedes = a.precision_attestation_id)
       ) prec on true
       left join lateral (
         select jsonb_agg(jsonb_build_object(
                  'attestation_id', p.attestation_id::text,
                  'available_not_before', to_char(p.available_not_before at time zone 'UTC', ${ISO_UTC}),
                  'available_no_later_than', to_char(p.available_no_later_than at time zone 'UTC', ${ISO_UTC}),
                  'timing_precision', p.timing_precision, 'source_timezone', p.source_timezone,
                  'proof_method', p.proof_method, 'mapping_version', p.mapping_version)
                  order by p.available_no_later_than, p.attestation_id) as publication
           from source_publication_attestations p
           left join documents d on d.document_id = p.document_id
          where p.source_id = f.source_id
            and p.source_version_hash = regexp_replace(coalesce(s.content_hash, ''), '^sha256:', '')
            and (p.document_id is null or d.deleted_at is null)
            and not exists (select 1 from source_publication_attestations newer where newer.supersedes = p.attestation_id)
       ) pub on true
      where f.subject_kind = $1::subject_kind and f.subject_id = $2::uuid and m.metric_key = $3
        and ($4::int is null or f.fiscal_year = $4::int)
        and ($5::text is null or f.fiscal_period = $5::text)
        and f.value_num is not null
        and f.value_num not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and f.invalidated_at is null
        and f.method in ('reported', 'extracted')
        and f.verification_status in ('authoritative', 'corroborated')
        and f.entitlement_channels ? $6
        and (s.user_id is null or ($7 = 'owner_visible' and s.user_id = $8::uuid))
      order by f.period_end nulls first, f.fact_id
      limit $9`,
    [
      request.subject.kind,
      request.subject.id,
      request.metric_key,
      request.fiscal_year,
      request.fiscal_period,
      request.channel,
      request.scope,
      request.user_id,
      request.limit + 1,
    ],
  );
  const rows = result.rows.map(toCandidate);
  return { candidates: rows.slice(0, request.limit), truncated: rows.length > request.limit };
}

function toCandidate(row: Record<string, unknown>): FinancialInputCandidate {
  return {
    fact_id: row.fact_id as string,
    metric_key: row.metric_key as string,
    period_kind: row.period_kind as string,
    period_start: row.period_start as string | null,
    period_end: row.period_end as string | null,
    fiscal_year: row.fiscal_year as number | null,
    fiscal_period: row.fiscal_period as string | null,
    value_text: row.value_text as string,
    scale_text: row.scale_text as string,
    unit: row.unit as string,
    currency: row.currency as string | null,
    method: row.method as FinancialInputCandidate["method"],
    verification_status: row.verification_status as FinancialInputCandidate["verification_status"],
    reported_at: row.reported_at as string | null,
    observed_at: row.observed_at as string,
    supersedes: row.supersedes as string | null,
    superseded_by: row.superseded_by as string | null,
    source_id: row.source_id as string,
    source_version_hash: row.source_version_hash as string | null,
    context: (row.context ?? null) as FinancialInputCandidate["context"],
    precision: (row.precision ?? null) as PrecisionProof | null,
    publication: row.publication as PublicationProof[],
  };
}
