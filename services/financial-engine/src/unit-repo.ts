// Predeclared publication units. Units and their dependency closures are
// written once (from the validated plan) and never revised; progress is
// derived from unit state, so a retry that repeats a transition changes
// nothing and emits no duplicate progress event. All writes take a FencedTx.

import { hashCanonical, unitClosures, type CoverageState, type FinancialPlanV1, type LocalId } from "../../financial-core/src/index.ts";
import { appendRunEvent } from "./events-repo.ts";
import { ExecutionIntegrityError } from "./errors.ts";
import type { FencedTx } from "./lease.ts";
import type { SqlExecutor } from "./ports.ts";

export type UnitState = "pending" | "computed" | "sealed" | "rejected";
export type UnitRecord = Readonly<{
  unit_id: LocalId;
  unit_kind: string;
  output_ids: ReadonlyArray<LocalId>;
  closure_node_ids: ReadonlyArray<LocalId>;
  closure_hash: string;
  state: UnitState;
  coverage_state: CoverageState | null;
  rejection_code: string | null;
}>;

/** Declares every publication unit of the plan; repeat declarations must match exactly. */
export async function declareUnits({ client, lease }: FencedTx, plan: FinancialPlanV1): Promise<void> {
  const kinds = new Map(plan.publication_units.map((unit) => [unit.unit_id, unit.kind]));
  for (const closure of unitClosures(plan).values()) {
    const closureHash = hashCanonical("unit_closure", { unit_id: closure.unit_id, output_ids: closure.output_ids, node_ids: closure.node_ids });
    await client.query(
      `insert into financial_run_units (run_id, unit_id, unit_kind, output_ids, closure_node_ids, closure_hash)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
       on conflict (run_id, unit_id) do nothing`,
      [lease.run_id, closure.unit_id, kinds.get(closure.unit_id), JSON.stringify(closure.output_ids), JSON.stringify(closure.node_ids), closureHash],
    );
    const stored = (await client.query<{ closure_hash: string }>(
      `select closure_hash from financial_run_units where run_id = $1 and unit_id = $2`,
      [lease.run_id, closure.unit_id],
    )).rows[0];
    if (stored?.closure_hash !== closureHash) throw new ExecutionIntegrityError(`unit ${closure.unit_id} was already declared with a different closure`);
  }
}

/** pending -> computed. Returns whether the state changed (progress counts only real transitions). */
export async function markUnitComputed(
  { client, lease }: FencedTx,
  unitId: LocalId,
  coverage: CoverageState,
): Promise<boolean> {
  const changed = await client.query(
    `update financial_run_units set state = 'computed', coverage_state = $3, updated_at = now()
      where run_id = $1 and unit_id = $2 and state = 'pending' returning unit_id`,
    [lease.run_id, unitId, coverage],
  );
  if (changed.rows.length === 0) return false;
  await appendRunEvent(client, lease.run_id, "unit_computed", { unit_id: unitId, payload: { coverage_state: coverage } });
  return true;
}

/** Rejects a unit whose closure failed integrity checks; rejection is final. */
export async function rejectUnit({ client, lease }: FencedTx, unitId: LocalId, reasonCode: string): Promise<boolean> {
  const changed = await client.query(
    `update financial_run_units set state = 'rejected', rejection_code = $3, updated_at = now()
      where run_id = $1 and unit_id = $2 and state in ('pending', 'computed') returning unit_id`,
    [lease.run_id, unitId, reasonCode],
  );
  if (changed.rows.length === 0) return false;
  await appendRunEvent(client, lease.run_id, "unit_rejected", { unit_id: unitId, payload: { reason_code: reasonCode } });
  return true;
}

export async function listUnits(client: SqlExecutor, runId: string): Promise<UnitRecord[]> {
  return (await client.query<UnitRecord>(
    `select unit_id, unit_kind, output_ids, closure_node_ids, closure_hash, state, coverage_state, rejection_code
       from financial_run_units where run_id = $1 order by unit_id`,
    [runId],
  )).rows;
}
