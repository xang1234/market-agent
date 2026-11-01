import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import type { ClaimPeriod } from "./claim-repo.ts";
import { factActiveSql, factKnownAtSql } from "./fact-activity.ts";
import type { VerifierFact } from "../../snapshot/src/snapshot-verifier.ts";

import { sourceDisclosure } from "./source-disclosure.ts";
import type { QueryExecutor } from "./types.ts";

export type LocalRuntimeEvidenceInput = {
  subject_refs: ReadonlyArray<SnapshotSubjectRef>;
  user_id?: string | null;
  exclude_claim_ids?: ReadonlyArray<string>;
  source_categories?: ReadonlyArray<string>;
  limit?: number;
  // Optional date boundary only; current document visibility always applies.
  as_of?: string;
  // A chat route's selection (#207): claims whose predicate starts with one of
  // the prefixes, dated from effective_from on (and before effective_until; for a
  // fiscal year, within the issuer's own where its facts date it), rank ahead of newer others; a
  // claim repeated (same company, predicate and text) counts once; and stored
  // contradiction relations among the selected are returned. The prefixes are
  // a priority, in order; a group of them shares one.
  selection?: { predicate_prefixes: ReadonlyArray<string | ReadonlyArray<string>> } & (
    | { effective_from: string | null; effective_until?: string | null; fiscal_year?: number | null; period?: null }
    // Only the claims the prefixes match that are bound to this period (#542).
    // No date window: when a claim was filed is not the period it explains.
    | { period: ClaimPeriod; effective_from?: never; effective_until?: never; fiscal_year?: never }
  );
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
  // The covered subject the claim matched, when the selection asked for it.
  subject_id?: string;
};

export type LocalRuntimeEvidence = {
  claims: ReadonlyArray<LocalRuntimeClaimEvidence>;
  // More claims matched than the limit returned.
  truncated?: boolean;
  // Pairs of selected claims a stored cluster relates as support vs contradict.
  contradictions?: ReadonlyArray<readonly [string, string]>;
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
  document_source_id: string;
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
  subject_id: string;
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
  const limit = input.limit ?? 5;

  const excludedClaimIds = unique(input.exclude_claim_ids ?? []);
  const sourceCategories = input.source_categories ?? null;
  const includeIssuerIr = (sourceCategories ?? []).includes("issuer_ir");
  const includeNonIr = sourceCategories === null || sourceCategories.some((category) => category !== "issuer_ir");
  // Each prefix with its tier: its position, shared by a group's.
  const selected = input.selection?.predicate_prefixes.flatMap((entry, tier) =>
    (typeof entry === "string" ? [entry] : entry).map((prefix) => ({ prefix, tier }))
  );
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
     -- The fiscal year asked about, as each covered issuer's facts known at the
     -- cutoff date it. Its end is where any of its figures places it: quarter n
     -- (discrete or year-to-date) ends 3 * (4 - n) months
     -- before it, so a year in progress ends where it will, not with its latest
     -- quarter; it started a year before. ponytail: a 52/53-week year can be a
     -- few days off.
     fiscal_years as (
       select y.subject_kind, y.subject_id, y.ends - interval '1 year' as starts, y.ends
         from (
           select f.subject_kind, f.subject_id,
                  max(f.period_end + make_interval(months => 3 * (4 - coalesce(substring(f.fiscal_period from '^Q([1-4])$')::int, 4))))
                    as ends
             from subject_refs sr
             join facts f
               on f.subject_kind = sr.subject_kind
              and f.subject_id = sr.subject_id
            where $13::int is not null
              and f.fiscal_year = $13::int
              and f.fiscal_period in ('Q1', 'Q2', 'Q3', 'Q4', 'FY')
              -- A balance is a point labelled "FY" whichever quarter it closes.
              and f.period_kind in ('fiscal_q', 'fiscal_y')
              and f.period_end is not null
              and (($7::timestamptz is null and ${factActiveSql("f")})
                   or ($7::timestamptz is not null and ${factKnownAtSql("f", "$7::timestamptz")}))
            group by f.subject_kind, f.subject_id
         ) y
     ),
     matching_claims as (
       select distinct on (c.claim_id)
              c.claim_id::text as claim_id,
              c.document_id::text as document_id,
              d.source_id::text as document_source_id,
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
              c.created_at as claim_created_at,
              sr.subject_id::text as subject_id,
              coalesce(c.predicate like any($8::text[]), false)
                and case
                  -- Never null for an unbound claim: a repeat's pick sorts
                  -- "relevant desc", which puts a null first.
                  when $14::text is not null then
                    coalesce(c.period_kind = $14::text and c.period_end = $15::date, false)
                  -- The releases about a fiscal year come out from the end of
                  -- its first quarter until a quarter after it ends. Its
                  -- guidance is given during it: the full year's with the last
                  -- year's results, just after it starts; the next year's,
                  -- after it ends, is not its.
                  when fy.ends is not null and c.predicate like 'guidance.%' then
                    coalesce(c.effective_time, d.published_at, c.created_at) >= fy.starts
                    and coalesce(c.effective_time, d.published_at, c.created_at) < fy.ends
                  when fy.ends is not null then
                    coalesce(c.effective_time, d.published_at, c.created_at) >= fy.starts + interval '3 months'
                    and coalesce(c.effective_time, d.published_at, c.created_at) < fy.ends + interval '3 months'
                  else ($9::timestamptz is null or coalesce(c.effective_time, d.published_at, c.created_at) >= $9::timestamptz)
                    and ($11::timestamptz is null or coalesce(c.effective_time, d.published_at, c.created_at) < $11::timestamptz)
                end
                as relevant,
              -- The route's prefixes are a priority: the tier of the first one
              -- the predicate matches (management explanations before newer
              -- guidance).
              (select min(p.tier) from unnest($8::text[], $12::int[]) as p(pattern, tier) where c.predicate like p.pattern)
                as tier
         from subject_refs sr
         join claim_arguments ca
           on ca.subject_kind = sr.subject_kind
          and ca.subject_id = sr.subject_id
         join claims c
           on c.claim_id = ca.claim_id
         left join fiscal_years fy
           on fy.subject_kind = sr.subject_kind
          and fy.subject_id = sr.subject_id
         join documents d
           on d.document_id = c.document_id
         join sources s
           on s.source_id = c.reported_by_source_id
        where c.status in ('extracted', 'corroborated')
          and c.superseded_at is null
          and d.deleted_at is null
          and d.parse_status <> 'superseded'
          and exists (select 1 from sources ds where ds.source_id=d.source_id
            and (ds.user_id is null or ds.user_id=$3::uuid))
          and ($7::timestamptz is null or (
            c.created_at <= $7::timestamptz
            and coalesce(d.published_at,d.created_at) <= $7::timestamptz
          ))
          and not (c.claim_id = any($4::uuid[]))
          -- A route reads a company's own claims: one naming it only as a
          -- competitor, customer or other party is another company's claim.
          and (not $10::boolean or ca.role = 'subject')
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
        -- The company the claim is about: its subject role before a competitor
        -- or affected party, the issuer row before a listing, then by id so the
        -- pick is stable.
        -- ponytail: a claim argued only about a listing keeps the listing's id.
        order by c.claim_id,
                 (ca.role = 'subject') desc,
                 (sr.subject_kind = 'issuer') desc,
                 sr.subject_id,
                 c.effective_time desc nulls last,
                 c.created_at desc
     ),
     -- A repeat is the same company, predicate and text (case-insensitive) for
     -- the same quarter (a statement made again a quarter later is new; an
     -- undated one by when it was published), however many
     -- sources or copied documents carry it: it counts once, as its first
     -- publication in the route's window (else its first), and the others never
     -- add support. Different sources do not show
     -- independence, so none is inferred.
     -- ponytail: exact text only; paraphrases are not caught.
     selected as (
       select distinct on (case when $10::boolean then subject_id || '|' || predicate || '|' || lower(text_canonical)
                                      || '|' || date_trunc('quarter', coalesce(effective_time, published_at, claim_created_at))::text else claim_id end) *
         from matching_claims
        order by case when $10::boolean then subject_id || '|' || predicate || '|' || lower(text_canonical)
                                      || '|' || date_trunc('quarter', coalesce(effective_time, published_at, claim_created_at))::text else claim_id end,
                 relevant desc, coalesce(published_at, claim_created_at) asc, claim_id
     )
     select claim_id,
            document_id,
            document_source_id,
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
            effective_time,
            subject_id
       from selected
      where $14::text is null or relevant
      -- Relevant claims first, by their prefix's priority; within each tier,
      -- companies and predicates take turns (each one's newest first), so a
      -- comparison's slots are not all one company's, nor a tier's all one
      -- metric's.
      order by relevant desc,
               case when relevant then tier end asc nulls last,
               case when $10::boolean
                 then row_number() over (
                   partition by relevant, case when relevant then tier end, subject_id, case when relevant then predicate end
                   order by coalesce(effective_time, published_at, claim_created_at) desc nulls last, claim_id desc)
                 else 0 end,
               coalesce(effective_time, published_at, claim_created_at) desc nulls last,
               claim_id desc
      limit $2::int + 1`,
    [
      JSON.stringify(subjectRefs),
      limit,
      userIdOrNull(input.user_id),
      excludedClaimIds,
      includeIssuerIr,
      includeNonIr,
      input.as_of ?? null,
      selected ? selected.map(({ prefix }) => `${prefix.replace(/[\\%_]/g, "\\$&")}%`) : null,
      input.selection?.effective_from ?? null,
      input.selection !== undefined,
      input.selection?.effective_until ?? null,
      selected ? selected.map(({ tier }) => tier) : null,
      input.selection?.fiscal_year ?? null,
      input.selection?.period?.kind ?? null,
      input.selection?.period?.end ?? null,
    ],
  );
  const evidence = evidenceFromClaimRows(subjectRefs, rows.slice(0, limit), input.selection !== undefined);
  if (!input.selection) return Object.freeze({ ...evidence, truncated: rows.length > limit });
  return Object.freeze({
    ...evidence,
    truncated: rows.length > limit,
    contradictions: await loadContradictions(db, evidence.claim_refs),
  });
}

// Selected claims one stored cluster holds on opposite sides (support vs
// contradict). Only pairs where both are selected, so each has its reference.
async function loadContradictions(
  db: QueryExecutor,
  claimIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<readonly [string, string]>> {
  if (claimIds.length < 2) return Object.freeze([]);
  const { rows } = await db.query<{ a: string; b: string }>(
    `select distinct a.claim_id::text as a, b.claim_id::text as b
       from claim_cluster_members a
       join claim_cluster_members b
         on b.cluster_id = a.cluster_id
        and b.claim_id > a.claim_id
        and b.relation <> a.relation
      where a.claim_id = any($1::uuid[])
        and b.claim_id = any($1::uuid[])
      order by a, b`,
    [claimIds],
  );
  return Object.freeze(rows.map((row) => Object.freeze([row.a, row.b] as const)));
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
  // cutoff: judge activity at the snapshot's moment, as the reader that chose
  // these facts did (see fact-activity.ts); omit for "now". requireKnownByCutoff
  // also requires the facts dated, observed and reported by then (fact blocks);
  // the seal leaves it off, since tool evidence is not read at the cutoff.
  input: { fact_refs: ReadonlyArray<string>; cutoff?: string; requireKnownByCutoff?: boolean },
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
    as_of: Date | string;
    fiscal_year: number | null;
    fiscal_period: string | null;
  }>(
    `select fact_id::text as fact_id,
            source_id::text as source_id,
            unit,
            period_kind,
            period_start::text as period_start,
            period_end::text as period_end,
            as_of,
            fiscal_year,
            fiscal_period
       from facts f
      where f.fact_id = any($1::uuid[])
        and ${input.cutoff === undefined
          ? factActiveSql("f")
          : input.requireKnownByCutoff
          ? factKnownAtSql("f", "$2::timestamptz")
          : factActiveSql("f", "$2::timestamptz")}`,
    input.cutoff === undefined ? [factIds] : [factIds, input.cutoff],
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
        as_of: new Date(row.as_of).toISOString(),
        fiscal_year: row.fiscal_year,
        fiscal_period: row.fiscal_period,
      }),
    ),
  );
}

function evidenceFromClaimRows(
  subjectRefs: ReadonlyArray<SnapshotSubjectRef>,
  rows: ReadonlyArray<ClaimEvidenceRow>,
  withSubject: boolean,
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
      ...(withSubject ? { subject_id: row.subject_id } : {}),
    }),
  );
  const documents = [...new Map(rows.map(row => [row.document_id,
    Object.freeze({ document_id: row.document_id, source_id: row.document_source_id }),
  ])).values()];
  const sourceIds = unique([...claims.map(claim => claim.source_id), ...documents.map(doc => doc.source_id)]);
  const documentRefs = unique(claims.map((claim) => claim.document_id));
  const claimRefs = unique(claims.map((claim) => claim.claim_id));

  return Object.freeze({
    claims: Object.freeze(claims),
    source_ids: Object.freeze(sourceIds),
    document_refs: Object.freeze(documentRefs),
    claim_refs: Object.freeze(claimRefs),
    subject_refs: Object.freeze([...subjectRefs]),
    verifier_sources: Object.freeze(sourceIds.map((source_id) => Object.freeze({ source_id }))),
    verifier_documents: Object.freeze(documents),
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
