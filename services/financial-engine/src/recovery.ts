// Recovery of financial runs whose worker died. A run is recoverable when its
// lease has expired (or it was never leased) and it is not terminal. Recovery
// takes a new lease — a higher epoch, so the dead worker is fenced out — and
// re-enters the same idempotent steps: bindings are reused, checkpointed units
// are kept, sealed units return their existing publication without calling the
// parent again, and events are appended only by the steps that actually run.
// No step is repeated after it committed, so a parent's progress is never
// counted twice.
//
// Standalone runs are resumed only for parents that registered how to rebuild
// their authority and persist their artifact. Discovery-owned runs are never
// reclaimed here: they resume only under the active Discovery worker's fence.
// A replay needs no parent registration: it reads pinned records and publishes
// nothing.

import { randomUUID } from "node:crypto";

import type { ExecutionLimits, FinancialPlanV1, FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import type { SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { executeRun, type ExecutionReport } from "./execute.ts";
import { finalizeUnit, type PersistParentArtifact } from "./finalize.ts";
import { acquireLease, type AcquireLeaseResult, type LeaseClaimant, type RunLease } from "./lease.ts";
import type { FinancialEvidencePort, SqlExecutor } from "./ports.ts";
import { executeReplay, replayClaimant, type ReplayOutcome } from "./replay.ts";
import { RUN_COLUMNS, toRun, type RunRecord } from "./run-record.ts";
import { requestCancellation } from "./run-repo.ts";
import type { FinancialVersionRegistry } from "./version-registry.ts";

/** How a parent feature lets a supervisor resume its runs. */
export type ParentRecovery = Readonly<{
  /** The run's current authority, or null when the parent no longer authorizes it (deleted, edited, disabled). */
  authority(run: RunRecord): Promise<FinancialRuntimeAuthority | null>;
  persistParent: PersistParentArtifact;
  parentLimits?: Partial<ExecutionLimits>;
}>;

export type RecoveryDeps = Readonly<{
  worker_id: string;
  ttl_ms: number;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
  parents: Readonly<Partial<Record<string, ParentRecovery>>>;
  registry?: FinancialVersionRegistry;
}>;

export type RecoveryOutcome =
  | Readonly<{ run_id: string; status: "replayed"; replay: ReplayOutcome }>
  | Readonly<{ run_id: string; status: "resumed"; execution: ExecutionReport["outcome"] | "skipped"; published: number; existing: number; rejected: number }>
  | Readonly<{ run_id: string; status: "cancelled" }>
  | Readonly<{ run_id: string; status: "skipped"; reason: "parent_not_registered" | "parent_withdrew" | Exclude<AcquireLeaseResult["status"], "acquired"> }>;

/** Non-terminal runs without a live lease that this supervisor may resume, oldest first. */
export async function listRecoverableRuns(db: SqlExecutor, input: { parent_kinds: ReadonlyArray<string>; limit: number }): Promise<RunRecord[]> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new RangeError("limit must be from 1 to 100");
  return (await db.query<Record<string, unknown>>(
    `select ${RUN_COLUMNS} from financial_runs
      where execution_state in ('pending', 'running', 'ready_to_seal')
        and parent_kind <> 'discovery_run'
        and (lease_owner is null or lease_expires_at <= now())
        and (replay_of_run_id is not null or cancel_requested_at is not null or parent_kind = any($1::text[]))
      order by updated_at, run_id
      limit $2`,
    [[...input.parent_kinds], input.limit],
  )).rows.map(toRun);
}

/** Resumes one run on a pinned client to wherever its idempotent steps lead. */
export async function recoverRun(client: SnapshotTransactionClient, run: RunRecord, deps: RecoveryDeps): Promise<RecoveryOutcome> {
  if (run.cancel_requested_at !== null) {
    // The lease holder died before honouring the cancellation; with its lease expired, this completes it.
    await requestCancellation(client, run.user_id, run.run_id);
    return { run_id: run.run_id, status: "cancelled" };
  }
  if (run.replay_of_run_id !== null) {
    const lease = await leaseFor(client, run, replayClaimant(run), deps);
    if (!("epoch" in lease)) return lease;
    return { run_id: run.run_id, status: "replayed", replay: await executeReplay({ client, lease, registry: deps.registry }) };
  }

  const parent = deps.parents[run.parent_kind];
  if (!parent) return { run_id: run.run_id, status: "skipped", reason: "parent_not_registered" };
  const authority = await parent.authority(run);
  if (!authority) return { run_id: run.run_id, status: "skipped", reason: "parent_withdrew" };
  const lease = await leaseFor(client, run, authority, deps);
  if (!("epoch" in lease)) return lease;

  let execution: ExecutionReport["outcome"] | "skipped" = "skipped";
  if (run.execution_state !== "ready_to_seal") {
    const plan = (await client.query<{ plan: FinancialPlanV1 }>(`select plan from financial_plans where plan_id = $1 and user_id = $2`, [run.plan_id, run.user_id])).rows[0]!.plan;
    const report = await executeRun({ client, lease, plan, authority, evidence: deps.evidence, parent_limits: parent.parentLimits ?? {} });
    execution = report.outcome;
    if (report.outcome !== "ready_to_seal") return { run_id: run.run_id, status: "resumed", execution, published: 0, existing: 0, rejected: 0 };
  }

  // Units sealed before the crash keep their publication; the parent is not called for them again.
  const units = (await client.query<{ unit_id: string; state: string }>(
    `select unit_id, state from financial_run_units where run_id = $1 and state in ('computed', 'sealed') order by unit_id`,
    [run.run_id],
  )).rows;
  const counts = { published: 0, existing: units.filter((unit) => unit.state === "sealed").length, rejected: 0 };
  for (const { unit_id } of units.filter((unit) => unit.state === "computed")) {
    const outcome = await finalizeUnit({ client, lease, authority, unit_id, snapshot_id: randomUUID(), persistParent: parent.persistParent });
    counts[outcome.status] += 1;
  }
  return { run_id: run.run_id, status: "resumed", execution, ...counts };
}

async function leaseFor(
  client: SqlExecutor,
  run: RunRecord,
  claimant: LeaseClaimant,
  deps: RecoveryDeps,
): Promise<RunLease | Extract<RecoveryOutcome, { status: "skipped" }>> {
  const acquired = await acquireLease(client, { authority: claimant, run_id: run.run_id, worker_id: deps.worker_id, ttl_ms: deps.ttl_ms });
  return acquired.status === "acquired" ? acquired.lease : { run_id: run.run_id, status: "skipped", reason: acquired.status };
}
