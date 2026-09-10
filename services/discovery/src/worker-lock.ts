import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import type { Lease } from "./ports.ts";
import { DiscoveryError } from "./types.ts";
import { isoDate, requireUuid } from "./repository-support.ts";

export async function lockLiveLease(
  tx: QueryExecutor,
  lease: Lease,
  now: Date,
  options: { allowCancelled?: boolean } = {},
): Promise<void> {
  requireUuid(lease.run_id, "run_id"); requireUuid(lease.user_id, "user_id");
  const owner = await tx.query<{ user_id: string }>("select user_id::text as user_id from users where user_id=$1::uuid for update", [lease.user_id]);
  if (!owner.rows[0]) throw new DiscoveryError("lease_lost", "lease owner no longer exists");
  const run = await tx.query<{ lease_epoch: number; lease_owner: string | null; lease_expires_at: Date | string | null; cancel_requested_at: Date | string | null }>(
    "select lease_epoch, lease_owner, lease_expires_at, cancel_requested_at from discovery_runs where run_id=$1::uuid and user_id=$2::uuid for update",
    [lease.run_id, lease.user_id],
  );
  const row = run.rows[0];
  if (!row || Number(row.lease_epoch) !== lease.epoch || row.lease_owner !== lease.worker_id || row.lease_expires_at === null || new Date(row.lease_expires_at).getTime() <= now.getTime()) {
    throw new DiscoveryError("lease_lost", "worker lease is no longer current");
  }
  if (row.cancel_requested_at !== null && !options.allowCancelled) throw new DiscoveryError("cancelled", "run cancellation was requested");
}

export function leaseFromRow(row: { run_id: string; user_id: string; lease_owner: string | null; lease_epoch: number; lease_expires_at: Date | string | null }): Lease {
  if (row.lease_owner === null || row.lease_expires_at === null) throw new Error("run did not return a lease");
  return { run_id: row.run_id, user_id: row.user_id, worker_id: row.lease_owner, epoch: Number(row.lease_epoch), expires_at: isoDate(row.lease_expires_at, "lease_expires_at")! };
}
