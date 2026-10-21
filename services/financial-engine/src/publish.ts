// Driving a leased run to published units, shared by every parent request
// (request.ts) and by recovery. Idempotent: a retry reuses the run's bindings
// and checkpoints, and units already sealed keep their publication and never
// reach the parent again.

import { randomUUID } from "node:crypto";

import type { ExecutionLimits, FinancialPlanV1, FinancialRuntimeAuthority, LocalId } from "../../financial-core/src/index.ts";
import type { SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { executeRun, type ExecutionReport } from "./execute.ts";
import { finalizeUnit, ParentRefusedError, type FinalizationResult, type PersistParentArtifact } from "./finalize.ts";
import { StaleLeaseError, type RunLease } from "./lease.ts";
import type { FinancialEvidencePort, SqlExecutor } from "./ports.ts";
import type { RunRecord } from "./run-record.ts";
import { isTransientDatabaseError } from "./transaction.ts";

export type PublishingDeps = Readonly<{
  authority: FinancialRuntimeAuthority;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
  parent_limits: Partial<ExecutionLimits>;
  persistParent: PersistParentArtifact;
}>;

export type DriveReport = Readonly<{
  run_id: string;
  execution: ExecutionReport["outcome"] | "skipped";
  /** Units finalized by this call, in unit order; units sealed earlier are counted in `existing`. */
  finalized: ReadonlyArray<Readonly<{ unit_id: LocalId; result: FinalizationResult }>>;
  existing: number;
}>;

/**
 * Whether a drive that threw left the run for a retry or recovery: the lease
 * lapsed, the parent refused, the database had a transient fault, or the
 * connection is gone. pg reports a lost connection without a code, and the
 * rollback on the dead client replaces the original error, so the client is
 * asked directly.
 */
export async function isRoutinePublicationFailure(client: SqlExecutor, error: unknown): Promise<boolean> {
  if (error instanceof StaleLeaseError || error instanceof ParentRefusedError || isTransientDatabaseError(error)) return true;
  return client.query("select 1").then(() => false, () => true);
}

/** Drives a leased run to its end: execute unless already computed, then finalize every computed unit. */
export async function driveLeasedRun(
  client: SnapshotTransactionClient,
  lease: RunLease,
  run: RunRecord,
  deps: PublishingDeps,
): Promise<DriveReport> {
  let execution: DriveReport["execution"] = "skipped";
  if (run.execution_state !== "ready_to_seal") {
    const plan = (await client.query<{ plan: FinancialPlanV1 }>(`select plan from financial_plans where plan_id = $1 and user_id = $2`, [run.plan_id, run.user_id])).rows[0]!.plan;
    const report = await executeRun({ client, lease, plan, authority: deps.authority, evidence: deps.evidence, parent_limits: deps.parent_limits });
    execution = report.outcome;
    if (report.outcome !== "ready_to_seal") return { run_id: run.run_id, execution, finalized: [], existing: 0 };
  }

  const units = (await client.query<{ unit_id: string; state: string }>(
    `select unit_id, state from financial_run_units where run_id = $1 and state in ('computed', 'sealed') order by unit_id`,
    [run.run_id],
  )).rows;
  const finalized: Array<{ unit_id: LocalId; result: FinalizationResult }> = [];
  for (const { unit_id } of units.filter((unit) => unit.state === "computed")) {
    finalized.push({ unit_id, result: await finalizeUnit({ client, lease, authority: deps.authority, unit_id, snapshot_id: randomUUID(), persistParent: deps.persistParent }) });
  }
  return { run_id: run.run_id, execution, finalized, existing: units.filter((unit) => unit.state === "sealed").length };
}
