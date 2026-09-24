// Loads the pinned records of one financial publication unit through the
// caller's (finalization) transaction client. Nothing here trusts caller
// arrays: every plan, binding, computation, and result comes from the ledger,
// and every bound fact is joined with its *current* evidence state — source
// access, invalidation, the exact source version, and whether the precision
// and publication proofs it was bound with are still the current ones.
// Snapshot reads these tables directly; it never imports the engine.

import type { QueryExecutor } from "./manifest-staging.ts";

export type FinancialSealClaim = Readonly<{ owner_user_id: string; run_id: string; unit_id: string }>;

export type LoadedRun = Readonly<{
  run_id: string;
  plan_id: string;
  parent_kind: string;
  parent_id: string;
  parent_version: string;
  request_hash: string;
  execution_state: string;
  knowledge_cutoff: string;
}>;

export type LoadedUnit = Readonly<{
  unit_id: string;
  state: string;
  coverage_state: string | null;
  output_ids: ReadonlyArray<string>;
  closure_node_ids: ReadonlyArray<string>;
  closure_hash: string;
}>;

export type LoadedBinding = Readonly<{
  input_slot: string;
  binding_status: "bound" | "gap";
  fact_id: string | null;
  publication_attestation_id: string | null;
  precision_attestation_id: string | null;
  bound_payload: unknown;
  payload_hash: string | null;
  gap_reason: string | null;
  candidate_set_digest: string;
}>;

/** Current evidence state of a bound fact. Absent when the fact no longer exists. */
export type LoadedEvidence = Readonly<{
  fact_id: string;
  source_id: string;
  invalidated: boolean;
  method: string;
  source_user_id: string | null;
  source_version_hash: string | null;
  /** The bound publication attestation, if it is still current and its document is not deleted. */
  publication: Readonly<{
    attestation_id: string;
    available_not_before: string | null;
    available_no_later_than: string;
    timing_precision: "instant" | "date" | "observed_public";
    source_timezone: string;
  }> | null;
  precision_current: boolean;
  context: Readonly<{
    period_type: string;
    dimension_scope: string;
    adjustment_basis: string;
    share_basis: string;
    fiscal_calendar_version: string;
  }> | null;
}>;

export type LoadedComputation = Readonly<{
  computation_id: string;
  node_id: string;
  formula_id: string;
  operation_version: string;
  numeric_policy_version: string;
  definition_versions: unknown;
  input_refs: unknown;
  output_hash: string;
}>;

export type LoadedResult = Readonly<{
  result_id: string;
  output_id: string;
  node_id: string;
  unit_id: string;
  computation_id: string | null;
  state: string;
  disposition: string;
  payload: unknown;
  dependencies: unknown;
  result_hash: string;
}>;

/** A subject's current display name: an issuer's legal name, or a listing's ticker and venue. */
export type LoadedSubjectName = Readonly<{ kind: "issuer" | "listing"; id: string; name: string }>;

export type FinancialUnitRecords = Readonly<{
  run: LoadedRun;
  plan: Readonly<{ plan: unknown; semantic_hash: string }>;
  unit: LoadedUnit | null;
  bindings: ReadonlyArray<LoadedBinding>;
  evidence: ReadonlyArray<LoadedEvidence>;
  computations: ReadonlyArray<LoadedComputation>;
  results: ReadonlyArray<LoadedResult>;
  subject_names: ReadonlyArray<LoadedSubjectName>;
}>;

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/** Null when the run does not exist for this owner: another owner's run is indistinguishable from none. */
export async function loadFinancialUnitRecords(db: QueryExecutor, claim: FinancialSealClaim): Promise<FinancialUnitRecords | null> {
  const run = (await db.query<LoadedRun & { plan: unknown; semantic_hash: string }>(
    `select r.run_id::text, r.plan_id::text, r.parent_kind, r.parent_id::text, r.parent_version, r.request_hash, r.execution_state,
            to_char(r.knowledge_cutoff at time zone 'UTC', ${ISO_UTC}) as knowledge_cutoff, p.plan, p.semantic_hash
       from financial_runs r
       join financial_plans p on p.plan_id = r.plan_id and p.user_id = r.user_id
      where r.run_id = $1 and r.user_id = $2`,
    [claim.run_id, claim.owner_user_id],
  )).rows[0];
  if (!run) return null;
  const { plan, semantic_hash, ...runRow } = run;

  const unit = (await db.query<LoadedUnit>(
    `select unit_id, state, coverage_state, output_ids, closure_node_ids, closure_hash
       from financial_run_units where run_id = $1 and unit_id = $2`,
    [claim.run_id, claim.unit_id],
  )).rows[0] ?? null;

  const bindings = (await db.query<LoadedBinding>(
    `select input_slot, binding_status, fact_id::text, publication_attestation_id::text, precision_attestation_id::text,
            bound_payload, payload_hash, gap_reason, candidate_set_digest
       from financial_run_inputs where run_id = $1 order by input_slot`,
    [claim.run_id],
  )).rows;

  const evidence = (await db.query<LoadedEvidence>(
    `select f.fact_id::text, f.source_id::text, f.invalidated_at is not null as invalidated, f.method::text,
            s.user_id::text as source_user_id, normalized_content_hash(s.content_hash) as source_version_hash,
            case when pub.attestation_id is null then null else jsonb_build_object(
              'attestation_id', pub.attestation_id::text,
              'available_not_before', to_char(pub.available_not_before at time zone 'UTC', ${ISO_UTC}),
              'available_no_later_than', to_char(pub.available_no_later_than at time zone 'UTC', ${ISO_UTC}),
              'timing_precision', pub.timing_precision,
              'source_timezone', pub.source_timezone) end as publication,
            prec.precision_attestation_id is not null as precision_current,
            case when c.fact_id is null then null else jsonb_build_object(
              'period_type', c.period_type, 'dimension_scope', c.dimension_scope, 'adjustment_basis', c.adjustment_basis,
              'share_basis', c.share_basis, 'fiscal_calendar_version', c.fiscal_calendar_version) end as context
       from financial_run_inputs i
       join facts f on f.fact_id = i.fact_id
       join sources s on s.source_id = f.source_id
       left join current_source_publication_attestations pub
              on pub.attestation_id = i.publication_attestation_id
             and not exists (select 1 from documents d where d.document_id = pub.document_id and d.deleted_at is not null)
       left join current_fact_precision_attestations prec on prec.precision_attestation_id = i.precision_attestation_id
       left join fact_financial_contexts c on c.fact_id = f.fact_id
      where i.run_id = $1 and i.binding_status = 'bound'
      order by f.fact_id`,
    [claim.run_id],
  )).rows;

  const computations = (await db.query<LoadedComputation>(
    `select computation_id::text, node_id, formula_id, operation_version, numeric_policy_version, definition_versions, input_refs, output_hash
       from computations where financial_run_id = $1 order by node_id`,
    [claim.run_id],
  )).rows;

  const results = (await db.query<LoadedResult>(
    `select result_id::text, output_id, node_id, unit_id, computation_id::text, state, disposition, payload, dependencies, result_hash
       from financial_results where run_id = $1 and unit_id = $2 order by output_id`,
    [claim.run_id, claim.unit_id],
  )).rows;

  const subject_names = await loadSubjectNames(db, planSubjectRefs(plan));

  return { run: runRow, plan: { plan, semantic_hash }, unit, bindings, evidence, computations, results, subject_names };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The plan is not validated yet; read its subject refs defensively. */
function planSubjectRefs(plan: unknown): Array<{ kind: string; id: string }> {
  const members = (plan as { subjects?: { members?: unknown } } | null)?.subjects?.members;
  if (!Array.isArray(members)) return [];
  return members.flatMap((member) => {
    const ref = (member as { subject_ref?: { kind?: unknown; id?: unknown } } | null)?.subject_ref;
    return typeof ref?.kind === "string" && typeof ref.id === "string" && UUID.test(ref.id) ? [{ kind: ref.kind, id: ref.id }] : [];
  });
}

export async function loadSubjectNames(
  db: QueryExecutor,
  refs: ReadonlyArray<{ kind: string; id: string }>,
): Promise<ReadonlyArray<LoadedSubjectName>> {
  const ids = (kind: string) => refs.filter((ref) => ref.kind === kind).map((ref) => ref.id);
  return (await db.query<LoadedSubjectName>(
    `select 'issuer' as kind, issuer_id::text as id, legal_name as name from issuers where issuer_id = any($1::uuid[])
     union all
     select 'listing', listing_id::text, ticker || ' (' || mic || ')' from listings where listing_id = any($2::uuid[])
     order by kind, id`,
    [ids("issuer"), ids("listing")],
  )).rows;
}
