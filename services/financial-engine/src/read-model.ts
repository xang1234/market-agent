// Owner-scoped, read-only views of financial runs and committed results. Every
// query here is a SELECT: opening a status or inspection view never acquires
// data, advances a run, or calls a model. Nothing unsealed leaks: units expose
// coverage, snapshots, and result ids only once sealed, and a result is
// readable only once finalized. Another owner's run or result is
// indistinguishable from a missing one.

import type { FinancialPlanV1, LocalId } from "../../financial-core/src/index.ts";
import type { SqlExecutor } from "./ports.ts";
import type { ExecutionState } from "./run-record.ts";

const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

export type UnitStatus = Readonly<{
  unit_id: LocalId;
  unit_kind: string;
  state: "pending" | "computed" | "sealed" | "rejected";
  /** Present only once sealed. */
  coverage_state: "complete" | "partial" | "none" | null;
  snapshot_id: string | null;
  certificate_digest: string | null;
  result_ids: ReadonlyArray<string>;
  /** Present only once rejected. */
  reason_code: string | null;
}>;

export type RunStatus = Readonly<{
  run_id: string;
  execution_state: ExecutionState;
  coverage_state: "complete" | "partial" | "none" | null;
  reason_code: string | null;
  cancel_requested: boolean;
  replay_of_run_id: string | null;
  knowledge_cutoff: string;
  interpretation: string | null;
  created_at: string;
  updated_at: string;
  units: ReadonlyArray<UnitStatus>;
}>;

export async function readRunStatus(db: SqlExecutor, ownerUserId: string, runId: string): Promise<RunStatus | null> {
  const run = (await db.query<Omit<RunStatus, "units">>(
    `select r.run_id::text, r.execution_state, r.coverage_state, r.failure_code as reason_code,
            r.cancel_requested_at is not null as cancel_requested, r.replay_of_run_id::text,
            to_char(r.knowledge_cutoff at time zone 'UTC', ${ISO_UTC}) as knowledge_cutoff, p.interpretation,
            to_char(r.created_at at time zone 'UTC', ${ISO_UTC}) as created_at, to_char(r.updated_at at time zone 'UTC', ${ISO_UTC}) as updated_at
       from financial_runs r
       join financial_plans p on p.plan_id = r.plan_id and p.user_id = r.user_id
      where r.run_id = $1 and r.user_id = $2`,
    [runId, ownerUserId],
  )).rows[0];
  if (!run) return null;
  const units = (await db.query<Omit<UnitStatus, "result_ids">>(
    `select unit_id, unit_kind, state,
            case when state = 'sealed' then coverage_state end as coverage_state,
            case when state = 'sealed' then snapshot_id::text end as snapshot_id,
            case when state = 'sealed' then certificate_digest end as certificate_digest,
            case when state = 'rejected' then rejection_code end as reason_code
       from financial_run_units where run_id = $1 order by unit_id`,
    [runId],
  )).rows;
  const committed = (await db.query<{ unit_id: string; result_id: string }>(
    `select unit_id, result_id::text from financial_results where run_id = $1 and state = 'finalized' order by unit_id, output_id`,
    [runId],
  )).rows;
  return {
    ...run,
    units: units.map((unit) => ({ ...unit, result_ids: committed.filter((row) => row.unit_id === unit.unit_id).map((row) => row.result_id) })),
  };
}

export type CommittedResultRecord = Readonly<{
  result_id: string;
  run_id: string;
  unit_id: LocalId;
  output_id: LocalId;
  node_id: LocalId;
  disposition: string;
  payload: unknown;
  result_hash: string;
  finalized_at: string;
  plan: FinancialPlanV1;
  interpretation: string | null;
  knowledge_cutoff: string;
  unit_coverage: "complete" | "partial" | "none" | null;
  snapshot_id: string;
  certificate_digest: string;
  certificate: Readonly<{ schema_version?: unknown; verifier_version?: unknown; presentation?: { version?: unknown } }>;
  computation: Readonly<{ formula_id: string; operation_version: string; numeric_policy_version: string; definition_versions: unknown }> | null;
}>;

/** A finalized result of a sealed unit, with its run, plan, certificate, and computation. */
export async function readCommittedResult(db: SqlExecutor, ownerUserId: string, resultId: string): Promise<CommittedResultRecord | null> {
  return (await db.query<CommittedResultRecord>(
    `select fr.result_id::text, fr.run_id::text, fr.unit_id, fr.output_id, fr.node_id, fr.disposition, fr.payload, fr.result_hash,
            to_char(fr.finalized_at at time zone 'UTC', ${ISO_UTC}) as finalized_at,
            p.plan, p.interpretation, to_char(r.knowledge_cutoff at time zone 'UTC', ${ISO_UTC}) as knowledge_cutoff,
            u.coverage_state as unit_coverage, u.snapshot_id::text, u.certificate_digest, c.certificate,
            case when comp.computation_id is null then null else jsonb_build_object(
              'formula_id', comp.formula_id, 'operation_version', comp.operation_version,
              'numeric_policy_version', comp.numeric_policy_version, 'definition_versions', comp.definition_versions) end as computation
       from financial_results fr
       join financial_runs r on r.run_id = fr.run_id and r.user_id = $2
       join financial_plans p on p.plan_id = r.plan_id and p.user_id = r.user_id
       join financial_run_units u on u.run_id = fr.run_id and u.unit_id = fr.unit_id and u.state = 'sealed'
       join snapshot_financial_runs c on c.run_id = fr.run_id and c.unit_id = fr.unit_id and c.snapshot_id = u.snapshot_id
       left join computations comp on comp.computation_id = fr.computation_id
      where fr.result_id = $1 and fr.state = 'finalized'`,
    [resultId, ownerUserId],
  )).rows[0] ?? null;
}

export type ClosureInput = Readonly<{
  input_slot: LocalId;
  binding_status: "bound" | "gap";
  bound_payload: unknown;
  gap_reason: string | null;
  /** Whether the fact, its source, and its publication document are still available to the owner. */
  available: boolean;
}>;

/**
 * The bound inputs of the given slots with their current availability. A fact
 * that was invalidated or deleted, a source the owner can no longer read, or a
 * publication document that was erased makes the input unavailable.
 */
export async function readClosureInputs(db: SqlExecutor, ownerUserId: string, runId: string, slots: ReadonlyArray<LocalId>): Promise<ReadonlyArray<ClosureInput>> {
  return (await db.query<ClosureInput>(
    `select i.input_slot, i.binding_status, i.bound_payload, i.gap_reason,
            i.binding_status = 'gap' or (
              f.fact_id is not null and f.invalidated_at is null
              and s.source_id is not null and (s.user_id is null or s.user_id = $3)
              and not exists (
                select 1 from source_publication_attestations pa join documents d on d.document_id = pa.document_id
                 where pa.attestation_id = i.publication_attestation_id and d.deleted_at is not null)
            ) as available
       from financial_run_inputs i
       left join facts f on f.fact_id = i.fact_id
       left join sources s on s.source_id = f.source_id
      where i.run_id = $1 and i.input_slot = any($2::text[])
      order by i.input_slot`,
    [runId, [...slots], ownerUserId],
  )).rows;
}
