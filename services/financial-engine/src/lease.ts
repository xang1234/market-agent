// Monotonically fenced leases. Acquiring a lease increments the epoch; every
// checkpoint and finalization write runs inside fencedTransaction, which
// re-checks the fence under the run row lock, so a worker whose lease
// expired, was superseded, or whose run was cancelled can never write. Fenced
// writers accept only a FencedTx, so an unfenced write does not type-check.
// Discovery-owned runs are resumed only under the parent campaign's
// authority, never reclaimed by a generic worker.

import type { FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import { appendRunEvent } from "./events-repo.ts";
import type { SqlExecutor } from "./ports.ts";
import { RUN_COLUMNS, toRun, type RunRecord } from "./run-record.ts";
import { withTransaction } from "./transaction.ts";

export type RunLease = Readonly<{ run_id: string; owner_user_id: string; worker_id: string; epoch: number }>;

declare const fencedBrand: unique symbol;

/** A transaction holding the run row lock under a verified lease. */
export type FencedTx = Readonly<{
  client: SqlExecutor;
  lease: RunLease;
  /** The run as locked at the fence. */
  run: RunRecord;
  readonly [fencedBrand]: true;
}>;

export type AcquireLeaseResult =
  | { status: "acquired"; lease: RunLease; run: RunRecord }
  | { status: "busy" | "not_found" | "terminal" | "cancel_requested" | "parent_authority_required" };

export class StaleLeaseError extends Error {
  readonly reason: "expired_or_superseded" | "cancel_requested" | "terminal";
  constructor(reason: StaleLeaseError["reason"]) {
    super(`financial run lease is no longer valid (${reason})`);
    this.name = "StaleLeaseError";
    this.reason = reason;
  }
}

export async function acquireLease(
  client: SqlExecutor,
  input: { authority: FinancialRuntimeAuthority; run_id: string; worker_id: string; ttl_ms: number },
): Promise<AcquireLeaseResult> {
  if (!Number.isSafeInteger(input.ttl_ms) || input.ttl_ms < 1_000 || input.ttl_ms > 3_600_000) throw new RangeError("ttl_ms must be from 1s to 1h");
  if (!/^[A-Za-z0-9_:.-]{1,128}$/u.test(input.worker_id)) throw new RangeError("worker_id must be a safe identifier");
  return withTransaction(client, async () => {
    const current = (await client.query<Record<string, unknown>>(
      `select ${RUN_COLUMNS}, lease_expires_at <= now() as lease_expired from financial_runs where run_id = $1 and user_id = $2 for update`,
      [input.run_id, input.authority.owner_user_id],
    )).rows[0];
    if (!current) return { status: "not_found" };
    const run = toRun(current);
    if (["completed", "failed", "cancelled"].includes(run.execution_state)) return { status: "terminal" };
    if (run.cancel_requested_at !== null) return { status: "cancel_requested" };
    if (run.parent_kind === "discovery_run" && !parentAuthorizes(input.authority, run)) return { status: "parent_authority_required" };
    const live = run.lease_owner !== null && current.lease_expired === false;
    if (live) return { status: "busy" };
    if (run.lease_owner !== null) {
      await appendRunEvent(client, run.run_id, "lease_expired", { payload: { lease_epoch: run.lease_epoch } });
    }
    const updated = toRun((await client.query<Record<string, unknown>>(
      `update financial_runs
          set lease_owner = $2, lease_epoch = lease_epoch + 1, lease_expires_at = now() + ($3::int * interval '1 millisecond'),
              execution_state = case when execution_state = 'pending' then 'running' else execution_state end, updated_at = now()
        where run_id = $1
        returning ${RUN_COLUMNS}`,
      [run.run_id, input.worker_id, input.ttl_ms],
    )).rows[0]!);
    await appendRunEvent(client, run.run_id, "lease_acquired", { payload: { lease_epoch: updated.lease_epoch, worker_id: input.worker_id } });
    return {
      status: "acquired",
      run: updated,
      lease: { run_id: run.run_id, owner_user_id: run.user_id, worker_id: input.worker_id, epoch: updated.lease_epoch },
    };
  });
}

export async function renewLease(client: SqlExecutor, lease: RunLease, ttlMs: number): Promise<void> {
  const renewed = await client.query(
    `update financial_runs set lease_expires_at = now() + ($5::int * interval '1 millisecond'), updated_at = now()
      where run_id = $1 and user_id = $2 and lease_owner = $3 and lease_epoch = $4 and lease_expires_at > now()
        and cancel_requested_at is null and execution_state in ('running', 'ready_to_seal')
      returning run_id`,
    [lease.run_id, lease.owner_user_id, lease.worker_id, lease.epoch, ttlMs],
  );
  if (renewed.rows.length === 0) throw new StaleLeaseError("expired_or_superseded");
}

/**
 * Runs `action` in one transaction that first locks the run row and verifies
 * the lease is still the current, live one. A pending cancellation fails the
 * fence unless the transaction is the one that honours it.
 */
export async function fencedTransaction<T>(
  client: SqlExecutor,
  lease: RunLease,
  action: (tx: FencedTx) => Promise<T>,
  options: { allowCancelRequested?: boolean; isolation?: "repeatable read" } = {},
): Promise<T> {
  return withTransaction(client, async () => {
    const run = await lockFencedRun(client, lease, options.allowCancelRequested ?? false);
    return action({ client, lease, run } as FencedTx);
  }, { isolation: options.isolation });
}

async function lockFencedRun(client: SqlExecutor, lease: RunLease, allowCancelRequested: boolean): Promise<RunRecord> {
  const row = (await client.query<Record<string, unknown>>(
    `select ${RUN_COLUMNS}, lease_expires_at > now() as lease_live from financial_runs where run_id = $1 and user_id = $2 for update`,
    [lease.run_id, lease.owner_user_id],
  )).rows[0];
  if (!row) throw new StaleLeaseError("expired_or_superseded");
  const run = toRun(row);
  if (["completed", "failed", "cancelled"].includes(run.execution_state)) throw new StaleLeaseError("terminal");
  if (run.lease_owner !== lease.worker_id || run.lease_epoch !== lease.epoch || row.lease_live !== true) throw new StaleLeaseError("expired_or_superseded");
  if (run.cancel_requested_at !== null && !allowCancelRequested) throw new StaleLeaseError("cancel_requested");
  return run;
}

/** A Discovery child run may only be leased under its parent run's fenced authority. */
function parentAuthorizes(authority: FinancialRuntimeAuthority, run: RunRecord): boolean {
  return authority.parent.kind === "discovery_run" && authority.parent.id === run.parent_id && authority.lease !== null;
}
