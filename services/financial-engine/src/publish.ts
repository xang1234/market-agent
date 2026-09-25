// The one path from a validated plan to published units, shared by every
// parent feature and by recovery. Every step is idempotent: a retry of the same
// request reuses the reserved run, its bindings, and its checkpoints; units
// already sealed keep their publication and never reach the parent again; a
// run that already completed is reported as such without any work.

import { randomUUID } from "node:crypto";

import type { ExecutionLimits, FinancialPlanV1, FinancialRuntimeAuthority, LocalId } from "../../financial-core/src/index.ts";
import type { SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { executeRun, type ExecutionReport } from "./execute.ts";
import { finalizeUnit, type FinalizationResult, type PersistParentArtifact } from "./finalize.ts";
import { acquireLease, releaseLease, type AcquireLeaseResult, type RunLease } from "./lease.ts";
import type { FinancialEvidencePort, SqlExecutor } from "./ports.ts";
import type { RunRecord } from "./run-record.ts";
import { reserveRun, type ReserveRunResult } from "./run-repo.ts";

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

export type PublishResult =
  | Readonly<{ status: "driven"; report: DriveReport }>
  | Readonly<{ status: "completed" | "failed" | "cancelled"; run: RunRecord }>
  | Readonly<{ status: "conflict"; reason: Extract<ReserveRunResult, { status: "conflict" }>["reason"] }>
  | Readonly<{ status: "unavailable"; run_id: string; reason: Exclude<AcquireLeaseResult["status"], "acquired"> }>;

/**
 * Reserves the run for `request_key` (or finds the one an earlier attempt
 * reserved), leases it, and drives it to published units. A retry after a
 * commit the caller never heard about lands on `completed` or on `existing`
 * units, never on a second publication.
 */
export async function reserveAndPublish(
  client: SnapshotTransactionClient,
  input: PublishingDeps & { plan: FinancialPlanV1; request_key: string; worker_id: string; ttl_ms: number },
): Promise<PublishResult> {
  const reserved = await reserveRun(client, { authority: input.authority, request_key: input.request_key, plan: input.plan });
  if (reserved.status === "conflict") return { status: "conflict", reason: reserved.reason };
  const { run } = reserved;
  if (run.execution_state === "completed" || run.execution_state === "failed" || run.execution_state === "cancelled") {
    return { status: run.execution_state, run };
  }
  const acquired = await acquireLease(client, { authority: input.authority, run_id: run.run_id, worker_id: input.worker_id, ttl_ms: input.ttl_ms });
  if (acquired.status !== "acquired") return { status: "unavailable", run_id: run.run_id, reason: acquired.status };
  try {
    return { status: "driven", report: await driveLeasedRun(client, acquired.lease, acquired.run, input) };
  } finally {
    // Whatever stopped this drive short (a failure, a rejected unit), the next attempt need not wait out the lease.
    await releaseLease(client, acquired.lease);
  }
}
