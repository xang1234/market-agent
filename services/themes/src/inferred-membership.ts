import type { QueryExecutor } from "../../observability/src/types.ts";
import type { SubjectKind, SubjectRef } from "../../resolver/src/subject-ref.ts";
import { addThemeMembership, type ThemeRow } from "./theme-repo.ts";

// Mirrors the impact_direction enum in spec/finance_research_db_schema.sql:40.
export const IMPACT_DIRECTIONS = ["positive", "negative", "mixed", "unknown"] as const;
export type ImpactDirection = (typeof IMPACT_DIRECTIONS)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InferredMembershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferredMembershipError";
  }
}

// Parsed shape of `themes.membership_spec` for membership_mode='inferred'.
// The jsonb column is opaque at the schema layer; this module owns the
// contract for inferred themes.
//
// cluster_ids — claim_clusters that scope which claims count as evidence.
//   Only claim_cluster_members.relation = 'support' is followed (hardcoded by
//   design — a subject contradicting an AI-Chips claim is not thereby an
//   AI-Chips member). If a future use case needs contradiction-driven
//   themes, extend this type with an explicit `relations` field rather than
//   flipping the default.
// min_confidence — optional floor on claims.confidence (0..1).
// impact_directions — optional filter on entity_impacts.direction. When
//   omitted, ALL directions including 'unknown' contribute; pass an explicit
//   ['positive', 'negative', 'mixed'] to exclude unknown-direction impacts.
//   When set, entity-impact links are constrained to these directions;
//   claim_arguments links are unaffected (they have no direction).
export type InferredMembershipSpec = {
  cluster_ids: ReadonlyArray<string>;
  min_confidence?: number;
  impact_directions?: ReadonlyArray<ImpactDirection>;
};

export type InferredCandidate = {
  subject_ref: SubjectRef;
  // Claim ids that backed the inference, sorted ascending. Persisted as
  // theme_memberships.rationale_claim_ids — the explainability anchor.
  rationale_claim_ids: ReadonlyArray<string>;
  // Count of distinct claims that contributed (= rationale_claim_ids.length).
  // Stored on theme_memberships.score so callers can rank inferred members
  // without re-running the inference query.
  score: number;
  // Compute-time-only diagnostic breakdown: how many of the contributing
  // rows came from claim_arguments vs entity_impacts. NOT persisted on
  // theme_memberships — the rationale_claim_ids array is the persistent
  // explainability anchor. The same claim can contribute to both buckets
  // when it names a subject as an argument *and* tags it with an
  // entity_impact, so signals.claim_arguments + signals.entity_impacts is
  // generally >= score. Useful for inspection/debugging; if a future
  // requirement needs the breakdown to survive a round-trip, extend the
  // theme_memberships schema with a provenance jsonb column.
  signals: { claim_arguments: number; entity_impacts: number };
};

export type ApplyInferredMembershipResult = {
  added: number;
  alreadyPresent: number;
  candidates: ReadonlyArray<InferredCandidate>;
};

// Validates and narrows an opaque membership_spec value. Optional fields
// accept both `undefined` and `null` as "absent" — JSON serialisers commonly
// emit `null` for omitted optional fields, and the persisted jsonb shape may
// have either form.
export function parseInferredMembershipSpec(
  value: unknown,
  label = "membership_spec",
): InferredMembershipSpec {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InferredMembershipError(`${label}: must be a JSON object`);
  }
  const spec = value as Record<string, unknown>;

  const rawClusterIds = spec.cluster_ids;
  if (!Array.isArray(rawClusterIds) || rawClusterIds.length === 0) {
    throw new InferredMembershipError(
      `${label}.cluster_ids: must be a non-empty array of UUID strings`,
    );
  }
  rawClusterIds.forEach((id, index) => {
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      throw new InferredMembershipError(`${label}.cluster_ids[${index}]: must be a UUID string`);
    }
  });
  if (new Set(rawClusterIds).size !== rawClusterIds.length) {
    throw new InferredMembershipError(`${label}.cluster_ids: must contain unique UUIDs`);
  }

  let minConfidence: number | undefined;
  if (spec.min_confidence !== undefined && spec.min_confidence !== null) {
    if (
      typeof spec.min_confidence !== "number" ||
      !Number.isFinite(spec.min_confidence) ||
      spec.min_confidence < 0 ||
      spec.min_confidence > 1
    ) {
      throw new InferredMembershipError(
        `${label}.min_confidence: must be a number in [0, 1] when provided`,
      );
    }
    minConfidence = spec.min_confidence;
  }

  let impactDirections: ReadonlyArray<ImpactDirection> | undefined;
  if (spec.impact_directions !== undefined && spec.impact_directions !== null) {
    if (!Array.isArray(spec.impact_directions) || spec.impact_directions.length === 0) {
      throw new InferredMembershipError(
        `${label}.impact_directions: must be a non-empty array when provided`,
      );
    }
    spec.impact_directions.forEach((d, index) => {
      if (!(IMPACT_DIRECTIONS as ReadonlyArray<string>).includes(d as string)) {
        throw new InferredMembershipError(
          `${label}.impact_directions[${index}]: must be one of ${IMPACT_DIRECTIONS.join(", ")}`,
        );
      }
    });
    if (new Set(spec.impact_directions).size !== spec.impact_directions.length) {
      throw new InferredMembershipError(`${label}.impact_directions: must contain unique values`);
    }
    impactDirections = Object.freeze([...(spec.impact_directions as ReadonlyArray<ImpactDirection>)]);
  }

  return Object.freeze({
    cluster_ids: Object.freeze([...rawClusterIds] as string[]),
    min_confidence: minConfidence,
    impact_directions: impactDirections,
  });
}

// Reads claim_clusters + claim_arguments + entity_impacts and returns the
// (subject, rationale_claim_ids) tuples that satisfy `theme.membership_spec`.
// Pure read — does NOT write to theme_memberships. Use this when you want to
// inspect the rationale chain without persisting (the verification path for
// fra-vme: "inspect rationale chain").
export async function computeInferredThemeCandidates(
  db: QueryExecutor,
  theme: ThemeRow,
): Promise<ReadonlyArray<InferredCandidate>> {
  if (theme.membership_mode !== "inferred") {
    throw new InferredMembershipError(
      `theme ${theme.theme_id}: membership_mode must be 'inferred' to compute candidates (got ${theme.membership_mode})`,
    );
  }
  const spec = parseInferredMembershipSpec(theme.membership_spec, `theme ${theme.theme_id}.membership_spec`);

  const minConfidence = spec.min_confidence ?? null;
  const impactDirections = spec.impact_directions ? [...spec.impact_directions] : null;

  // Single query so the join cost lands once. The two link sources
  // (claim_arguments, entity_impacts) are unioned before grouping so a
  // subject mentioned by both kinds of signal still aggregates to a single
  // row with a single rationale list.
  // Stub-tested in inferred-membership.test.ts; live SQL coverage against a
  // real pg instance is tracked in fra-fp7.
  const { rows } = await db.query<InferredCandidateDbRow>(
    `with cluster_claims as (
       select distinct cm.claim_id
         from claim_cluster_members cm
        where cm.cluster_id = any($1::uuid[])
          and cm.relation = 'support'
     ),
     arg_links as (
       select ca.subject_kind, ca.subject_id, ca.claim_id,
              1 as arg_signal, 0 as impact_signal
         from claim_arguments ca
         join cluster_claims cc on cc.claim_id = ca.claim_id
         join claims c on c.claim_id = ca.claim_id
        where ($2::numeric is null or c.confidence >= $2::numeric)
     ),
     impact_links as (
       select ei.subject_kind, ei.subject_id, ei.claim_id,
              0 as arg_signal, 1 as impact_signal
         from entity_impacts ei
         join cluster_claims cc on cc.claim_id = ei.claim_id
         join claims c on c.claim_id = ei.claim_id
        where ($2::numeric is null or c.confidence >= $2::numeric)
          and ($3::impact_direction[] is null or ei.direction = any($3::impact_direction[]))
     ),
     all_links as (
       select * from arg_links
       union all
       select * from impact_links
     )
     select subject_kind,
            subject_id::text as subject_id,
            array_agg(distinct claim_id::text order by claim_id::text) as rationale_claim_ids,
            count(distinct claim_id)::int as distinct_claim_count,
            sum(arg_signal)::int as arg_signals,
            sum(impact_signal)::int as impact_signals
       from all_links
      group by subject_kind, subject_id
      order by count(distinct claim_id) desc, subject_kind asc, subject_id asc`,
    [[...spec.cluster_ids], minConfidence, impactDirections],
  );

  return Object.freeze(rows.map(inferredCandidateFromDb));
}

// Sanity cap on per-apply candidate count. A theme with broad cluster
// coverage could otherwise issue tens of thousands of round-trips through
// addThemeMembership. Callers that legitimately need a higher cap can pass
// `maxCandidates` explicitly. The exception surfaces the count so the caller
// can decide whether to tighten the spec or accept the larger batch.
export const DEFAULT_INFERRED_APPLY_MAX_CANDIDATES = 1000;

export type ApplyInferredMembershipOptions = {
  maxCandidates?: number;
};

// Persists computed candidates as theme_memberships rows. Calls
// addThemeMembership per candidate, which is idempotent at
// (theme_id, subject_kind, subject_id) — re-running is safe and existing
// memberships are reported back as `alreadyPresent`.
//
// Known gaps (out of scope for fra-vme's "inspect rationale chain"
// verification, tracked separately):
// - rationale_claim_ids on already-present memberships is not refreshed
//   (documented on addThemeMembership in theme-repo.ts).
// - The per-candidate loop does NOT wrap itself in a transaction; pass a
//   pg.Client obtained via `await pool.connect()` followed by
//   `client.query("begin")` if atomicity is required (the QueryExecutor
//   surface accepts a Client). A partial failure mid-loop otherwise leaves
//   the DB half-applied with no built-in rollback.
export async function applyInferredThemeMembership(
  db: QueryExecutor,
  theme: ThemeRow,
  options: ApplyInferredMembershipOptions = {},
): Promise<ApplyInferredMembershipResult> {
  const maxCandidates = options.maxCandidates ?? DEFAULT_INFERRED_APPLY_MAX_CANDIDATES;
  if (!Number.isInteger(maxCandidates) || maxCandidates <= 0) {
    throw new InferredMembershipError(
      `applyInferredThemeMembership: maxCandidates must be a positive integer (got ${maxCandidates})`,
    );
  }
  const candidates = await computeInferredThemeCandidates(db, theme);
  if (candidates.length > maxCandidates) {
    throw new InferredMembershipError(
      `applyInferredThemeMembership: theme ${theme.theme_id} matched ${candidates.length} candidates, exceeding the ${maxCandidates} per-apply cap; tighten the spec or raise maxCandidates explicitly`,
    );
  }
  let added = 0;
  let alreadyPresent = 0;
  for (const candidate of candidates) {
    const result = await addThemeMembership(db, {
      theme_id: theme.theme_id,
      subject_ref: candidate.subject_ref,
      score: candidate.score,
      rationale_claim_ids: candidate.rationale_claim_ids,
    });
    if (result.status === "created") {
      added += 1;
    } else {
      alreadyPresent += 1;
    }
  }
  return Object.freeze({ added, alreadyPresent, candidates });
}

type InferredCandidateDbRow = {
  subject_kind: SubjectKind;
  subject_id: string;
  rationale_claim_ids: ReadonlyArray<string>;
  distinct_claim_count: number;
  arg_signals: number;
  impact_signals: number;
};

function inferredCandidateFromDb(row: InferredCandidateDbRow): InferredCandidate {
  if (!Array.isArray(row.rationale_claim_ids)) {
    throw new InferredMembershipError(
      `inferred candidate row: rationale_claim_ids must be an array (got ${typeof row.rationale_claim_ids})`,
    );
  }
  if (!row.rationale_claim_ids.every((id) => typeof id === "string" && id.length > 0)) {
    throw new InferredMembershipError(
      `inferred candidate row: rationale_claim_ids must be non-empty strings`,
    );
  }
  return Object.freeze({
    subject_ref: { kind: row.subject_kind, id: row.subject_id },
    rationale_claim_ids: Object.freeze([...row.rationale_claim_ids]),
    score: row.distinct_claim_count,
    signals: Object.freeze({
      claim_arguments: row.arg_signals,
      entity_impacts: row.impact_signals,
    }),
  });
}

